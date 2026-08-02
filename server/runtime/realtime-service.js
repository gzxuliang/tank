// 通用实时对局服务：房间、席位、输入队列、固定帧推进、快照和断线恢复
import crypto from 'node:crypto';

export const PROTOCOL_VERSION = 3;

const OPEN = 1;
const DEFAULT_TICK_RATE = 60;
const DEFAULT_SNAPSHOT_RATE = 30;
const MAX_INPUT_QUEUE = 180;
const MAX_INPUTS_PER_TICK = 4;
const MAX_INPUT_CREDIT = 18;

function send(socket, message) {
  if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message));
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function makeSeat(index) {
  return {
    index,
    socket: null,
    token: token(),
    epoch: 1,
    connected: false,
    disconnectedAt: 0,
    expired: false,
    ack: 0,
    lastQueuedSeq: 0,
    queue: [],
    inputCredit: 0,
  };
}

export class GameRegistry {
  constructor() { this.definitions = new Map(); }

  register(definition) {
    if (!definition || !definition.id || typeof definition.createMatch !== 'function') {
      throw new Error('游戏定义必须包含 id 和 createMatch');
    }
    this.definitions.set(definition.id, definition);
    return this;
  }

  get(id) { return this.definitions.get(id); }
}

export class RealtimeGameService {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.rooms = new Map();
    this.tickRate = options.tickRate || DEFAULT_TICK_RATE;
    this.snapshotRate = options.snapshotRate || DEFAULT_SNAPSHOT_RATE;
    this.reconnectMs = options.reconnectMs || 30_000;
    this.roomIdleMs = options.roomIdleMs || 30 * 60 * 1000;
    this.now = options.now || (() => Date.now());
    this.frame = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    const frameMs = 1000 / this.tickRate;
    let previous = this.now();
    let accumulator = 0;
    this.timer = setInterval(() => {
      const current = this.now();
      accumulator += Math.min(250, Math.max(0, current - previous));
      previous = current;
      let steps = 0;
      while (accumulator >= frameMs && steps < 4) {
        this.tick();
        accumulator -= frameMs;
        steps++;
      }
      if (steps === 4) accumulator = Math.min(accumulator, frameMs);
    }, Math.max(4, Math.floor(frameMs / 2)));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  attach(socket) {
    socket._matchSeat = null;
  }

  handleMessage(socket, message) {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'create') return this._create(socket, message);
    if (message.t === 'join') return this._join(socket, message);
    if (message.t === 'resume') return this._resume(socket, message);

    const binding = socket._matchSeat;
    if (!binding) return;
    const room = this.rooms.get(binding.code);
    const seat = room && room.seats[binding.slot];
    if (!room || !seat || seat.socket !== socket || message.epoch !== seat.epoch) return;
    if (message.t === 'input') this._queueInput(room, seat, message.frames);
    else if (message.t === 'command' && room.match) room.match.handleCommand(seat.index, message);
  }

  handleClose(socket) {
    const binding = socket._matchSeat;
    socket._matchSeat = null;
    if (!binding) return;
    const room = this.rooms.get(binding.code);
    const seat = room && room.seats[binding.slot];
    if (!seat || seat.socket !== socket) return;
    seat.socket = null;
    seat.connected = false;
    seat.disconnectedAt = this.now();
    seat.queue.length = 0;
    this._broadcast(room, { t: 'seat-status', slot: seat.index, connected: false, graceMs: this.reconnectMs });
  }

  tick() {
    this.frame++;
    const now = this.now();
    for (const [code, room] of this.rooms) {
      this._expireSeats(room, now);
      if (!room.match) {
        if (now - room.createdAt > this.roomIdleMs) {
          this._broadcast(room, { t: 'error', msg: '房间超时未有人加入，已关闭' });
          this._closeRoom(code);
        }
        continue;
      }

      for (const seat of room.seats) this._consumeSeatInputs(room, seat);
      room.match.step();
      this._flushEvents(room);

      if (this.frame % Math.max(1, Math.round(this.tickRate / this.snapshotRate)) === 0) {
        this._broadcastSnapshots(room);
      }
      if (room.seats.every((seat) => seat.expired)) this._closeRoom(code);
    }
  }

  _create(socket, message) {
    if (socket._matchSeat) return;
    if (message.protocol !== PROTOCOL_VERSION) return send(socket, { t: 'error', msg: '客户端与服务器版本不一致，请刷新页面并重启服务器' });
    const definition = this.registry.get(message.game || 'tank');
    if (!definition) return send(socket, { t: 'error', msg: '服务器不支持这个游戏' });
    const code = this._makeCode();
    if (!code) return send(socket, { t: 'error', msg: '房间已满，请稍后再试' });
    const room = {
      code,
      definition,
      createdAt: this.now(),
      seats: Array.from({ length: definition.seatCount || 2 }, (_, index) => makeSeat(index)),
      match: null,
    };
    this.rooms.set(code, room);
    this._bind(socket, room, room.seats[0]);
    send(socket, this._welcome('created', room, room.seats[0]));
  }

  _join(socket, message) {
    if (socket._matchSeat) return;
    if (message.protocol !== PROTOCOL_VERSION) return send(socket, { t: 'error', msg: '客户端与服务器版本不一致，请刷新页面并重启服务器' });
    const room = this.rooms.get(String(message.code || ''));
    if (!room) return send(socket, { t: 'error', msg: '房间不存在' });
    const seat = room.seats.find((candidate) => candidate.index > 0 && !candidate.connected && !candidate.expired);
    if (!seat || room.match) return send(socket, { t: 'error', msg: '房间已满' });
    this._bind(socket, room, seat);
    send(socket, this._welcome('joined', room, seat));
    for (const existing of room.seats) {
      if (existing !== seat && existing.connected) {
        send(existing.socket, { ...this._welcome('peer-joined', room, existing), peerSlot: seat.index });
      }
    }
    if (room.seats.every((candidate) => candidate.connected)) {
      room.match = room.definition.createMatch({ tickRate: this.tickRate, seats: room.seats.length });
      this._flushEvents(room);
    }
  }

  _resume(socket, message) {
    if (socket._matchSeat || message.protocol !== PROTOCOL_VERSION) return;
    const room = this.rooms.get(String(message.code || ''));
    const seat = room && room.seats.find((candidate) => candidate.token === message.token && !candidate.expired);
    if (!seat || !room.match || seat.expired ||
        (!seat.connected && this.now() - seat.disconnectedAt > this.reconnectMs)) {
      send(socket, { t: 'resume-rejected', msg: '对局已结束或恢复时间已超过 30 秒' });
      return;
    }
    const previousSocket = seat.socket;
    seat.epoch++;
    seat.ack = 0;
    seat.lastQueuedSeq = 0;
    seat.queue.length = 0;
    seat.inputCredit = MAX_INPUT_CREDIT;
    room.match.onSeatResumed?.(seat.index);
    this._bind(socket, room, seat);
    if (previousSocket && previousSocket !== socket) previousSocket.terminate();
    send(socket, this._welcome('resumed', room, seat));
    send(socket, room.match.phaseMessage());
    this._sendSnapshot(room, seat, true);
    this._broadcast(room, { t: 'seat-status', slot: seat.index, connected: true }, seat.index);
  }

  _bind(socket, room, seat) {
    seat.socket = socket;
    seat.connected = true;
    seat.disconnectedAt = 0;
    seat.expired = false;
    socket._matchSeat = { code: room.code, slot: seat.index };
  }

  _welcome(type, room, seat) {
    return {
      t: type,
      protocol: PROTOCOL_VERSION,
      game: room.definition.id,
      code: room.code,
      slot: seat.index,
      token: seat.token,
      epoch: seat.epoch,
    };
  }

  _queueInput(room, seat, frames) {
    if (!room.match || !Array.isArray(frames) || frames.length > 8) return;
    for (const frame of frames) {
      if (!room.definition.validateInput(frame)) continue;
      if (frame.seq <= seat.lastQueuedSeq || frame.seq <= seat.ack) continue;
      if (seat.queue.length >= MAX_INPUT_QUEUE) break;
      seat.queue.push(frame);
      seat.lastQueuedSeq = frame.seq;
    }
  }

  _consumeSeatInputs(room, seat) {
    if (seat.expired) return;
    seat.inputCredit = Math.min(MAX_INPUT_CREDIT, seat.inputCredit + 1);
    if (!room.match.canAcceptInput(seat.index)) {
      // 开幕/结算/结束阶段客户端本就不发输入；队列里滞留的是上一阶段的
      // 旧输入，直接丢弃，否则会在下一阶段开头“漂移”执行。
      seat.queue.length = 0;
      return;
    }
    let count = 0;
    while (seat.queue.length && seat.inputCredit >= 1 && count < MAX_INPUTS_PER_TICK) {
      const frame = seat.queue.shift();
      const result = room.match.applyInput(seat.index, { ...frame, epoch: seat.epoch });
      seat.ack = frame.seq;
      seat.inputCredit--;
      count++;
      if (result && result.fire) send(seat.socket, { t: 'fire-result', epoch: seat.epoch, ...result.fire });
    }
  }

  _flushEvents(room) {
    for (const event of room.match.drainEvents()) {
      if (event.slot === undefined) this._broadcast(room, event);
      else send(room.seats[event.slot].socket, event);
    }
  }

  _broadcastSnapshots(room) {
    for (const seat of room.seats) if (seat.connected) this._sendSnapshot(room, seat, false);
    room.match.afterSnapshot();
  }

  _sendSnapshot(room, seat, full) {
    const snapshot = room.match.snapshot(seat.index, full);
    if (!snapshot) return;
    send(seat.socket, { ...snapshot, ack: seat.ack, epoch: seat.epoch, full: !!full });
  }

  _expireSeats(room, now) {
    for (const seat of room.seats) {
      if (seat.expired || seat.connected || !seat.disconnectedAt) continue;
      if (now - seat.disconnectedAt <= this.reconnectMs) continue;
      seat.expired = true;
      seat.token = '';
      seat.queue.length = 0;
      room.match?.removePlayer(seat.index);
      this._broadcast(room, { t: 'seat-status', slot: seat.index, connected: false, removed: true });
    }
  }

  _broadcast(room, message, exceptSlot = -1) {
    for (const seat of room.seats) if (seat.index !== exceptSlot) send(seat.socket, message);
  }

  _closeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const seat of room.seats) {
      if (seat.socket) seat.socket._matchSeat = null;
      seat.socket = null;
    }
    this.rooms.delete(code);
  }

  _makeCode() {
    for (let i = 0; i < 100; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }
}

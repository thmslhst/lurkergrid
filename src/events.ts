import type { vec3 } from './math';

export type NodeSpawnEvent  = { type: 'node:spawn';   pos: vec3; nodeId: number; t: number };
export type ConnectionEvent = { type: 'node:connect'; posA: vec3; posB: vec3; t: number };
export type CollisionEvent  = { type: 'node:collide'; pos: vec3; nodeId: number; t: number };
export type AppEvent = NodeSpawnEvent | ConnectionEvent | CollisionEvent;

type Listener = (event: AppEvent) => void;

export class EventBus {
  private listeners: Listener[] = [];

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(event: AppEvent): void {
    for (const fn of this.listeners) fn(event);
  }
}

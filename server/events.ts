// In-process fan-out of "something changed" notices to connected clients (SSE).
export interface ChangeEvent {
  seq: number;
  clientId: string;
}

type Listener = (e: ChangeEvent) => void;

export class ChangeBus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ChangeEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get size() {
    return this.listeners.size;
  }
}

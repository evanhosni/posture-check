export type Handler<T> = (payload: T) => void

export class Emitter<Events> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>) {
    const set = this.handlers.get(event) ?? new Set()
    set.add(handler as Handler<never>)
    this.handlers.set(event, set)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>) {
    this.handlers.get(event)?.delete(handler as Handler<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]) {
    for (const handler of this.handlers.get(event) ?? []) {
      ;(handler as Handler<Events[K]>)(payload)
    }
  }

  clear() {
    this.handlers.clear()
  }
}

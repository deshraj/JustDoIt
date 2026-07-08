export type EntityType = 'task' | 'project' | 'time_entry';

export type DomainEventAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'completed'
  | 'started'
  | 'stopped'
  | 'logged';

export interface DomainEvent {
  /** Dotted event name, e.g. 'task.updated' | 'project.created' | 'time.started'. */
  type: string;
  entityType: EntityType;
  entityId: string;
  action: DomainEventAction;
  payload?: Record<string, unknown>;
  /** Epoch milliseconds (from the injected clock at the call site). */
  at: number;
}

export type EventListener = (event: DomainEvent) => void;

export class EventBus {
  #listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: DomainEvent): void {
    // Copy so a subscriber that (un)subscribes during dispatch can't corrupt iteration.
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // Subscriber failures are isolated: one bad listener never breaks a mutation.
      }
    }
  }

  reset(): void {
    this.#listeners.clear();
  }
}

/** Process-wide bus. Services publish here; the API's SSE route and activity logger subscribe. */
export const events = new EventBus();

import { events, type DomainEventAction, type EntityType } from './bus';

const PREFIX: Record<EntityType, string> = {
  task: 'task',
  project: 'project',
  time_entry: 'time',
};

/** Thin helper services call at the end of a mutation. Keeps call sites to one line. */
export function emit(
  userId: string,
  entityType: EntityType,
  entityId: string,
  action: DomainEventAction,
  payload?: Record<string, unknown>,
  at: number = Date.now(),
): void {
  events.publish({
    type: `${PREFIX[entityType]}.${action}`,
    userId,
    entityType,
    entityId,
    action,
    payload,
    at,
  });
}

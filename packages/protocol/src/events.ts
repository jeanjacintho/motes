import { z } from 'zod';
import { timestampSchema } from './base.js';
import { CARD_STATUSES } from './cards.js';
import { idSchema } from './ids.js';
import { type ParseLogger, parseWithFallback, tolerantEnum } from './parsing.js';

const actorKinds = ['owner', 'bot', 'system', 'runtime'] as const;
const actorSchema = z.object({
  kind: z.enum(actorKinds),
  id: z.string().min(1).optional(),
});

export const eventEnvelopeSchema = z.object({
  id: idSchema('event'),
  type: z.string().min(1),
  occurredAt: timestampSchema,
  actor: actorSchema,
  subject: z.object({ kind: z.string().min(1), id: z.string().min(1) }),
  payload: z.json(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Each feature declares its literal event type and payload contract once. */
export function defineEvent<const Type extends string, Payload extends z.ZodType>(
  type: Type,
  payloadSchema: Payload,
) {
  const schema = eventEnvelopeSchema.extend({ type: z.literal(type), payload: payloadSchema });
  return Object.freeze({ type, payloadSchema, schema });
}

// Ping carries no data; its envelope supplies identity and time for the P0 gate.
const systemPing = defineEvent('system.ping', z.strictObject({}));
const pairingChanged = defineEvent('pairing.changed', z.strictObject({}));
const devicePaired = defineEvent('device.paired', z.strictObject({}));
const deviceUsed = defineEvent('device.used', z.strictObject({}));
const deviceRevoked = defineEvent('device.revoked', z.strictObject({}));
const projectCreated = defineEvent(
  'project.created',
  z.strictObject({ key: z.string().min(1), name: z.string().min(1) }),
);
const projectRenamed = defineEvent('project.renamed', z.strictObject({ name: z.string().min(1) }));
const projectArchived = defineEvent('project.archived', z.strictObject({}));
const repositoryAdded = defineEvent(
  'repository.added',
  z.strictObject({ projectId: idSchema('project'), name: z.string().min(1) }),
);
const repositoryUpdated = defineEvent(
  'repository.updated',
  z.strictObject({ projectId: idSchema('project') }),
);
const repositoryRemoved = defineEvent(
  'repository.removed',
  z.strictObject({ projectId: idSchema('project') }),
);
const repositoryPathSet = defineEvent(
  'repository.path_set',
  z.strictObject({ projectId: idSchema('project'), runtimeId: idSchema('runtime') }),
);
export const CARD_EDITABLE_FIELDS = ['title', 'description', 'priority', 'repositoryId'] as const;
const cardCreated = defineEvent(
  'card.created',
  z.strictObject({ projectId: idSchema('project'), number: z.number().int().positive() }),
);
const cardUpdated = defineEvent(
  'card.updated',
  z.strictObject({
    projectId: idSchema('project'),
    changed: z.array(z.enum(CARD_EDITABLE_FIELDS)).min(1),
  }),
);
// A null assignee means the card became unassigned.
const cardAssigned = defineEvent(
  'card.assigned',
  z.strictObject({
    projectId: idSchema('project'),
    assignee: z.strictObject({ type: z.enum(['owner', 'bot']), id: z.string().min(1) }).nullable(),
  }),
);
const cardStatusChanged = defineEvent(
  'card.status_changed',
  z.strictObject({
    projectId: idSchema('project'),
    from: z.enum(CARD_STATUSES),
    to: z.enum(CARD_STATUSES),
    reason: z.string().nullable(),
  }),
);
// Carries the card's complete label set after the change, in label-name order.
const cardLabelsChanged = defineEvent(
  'card.labels_changed',
  z.strictObject({ projectId: idSchema('project'), labelIds: z.array(idSchema('label')) }),
);
const labelCreated = defineEvent(
  'label.created',
  z.strictObject({ projectId: idSchema('project') }),
);
const labelUpdated = defineEvent(
  'label.updated',
  z.strictObject({ projectId: idSchema('project') }),
);
const labelDeleted = defineEvent(
  'label.deleted',
  z.strictObject({ projectId: idSchema('project') }),
);
// A reorder inside one column; moves to another column are card.status_changed.
const cardMoved = defineEvent(
  'card.moved',
  z.strictObject({ projectId: idSchema('project'), status: z.enum(CARD_STATUSES) }),
);
const cardDeleted = defineEvent('card.deleted', z.strictObject({ projectId: idSchema('project') }));
export const eventRegistry = Object.freeze({
  [systemPing.type]: systemPing,
  [pairingChanged.type]: pairingChanged,
  [devicePaired.type]: devicePaired,
  [deviceUsed.type]: deviceUsed,
  [deviceRevoked.type]: deviceRevoked,
  [projectCreated.type]: projectCreated,
  [projectRenamed.type]: projectRenamed,
  [projectArchived.type]: projectArchived,
  [repositoryAdded.type]: repositoryAdded,
  [repositoryUpdated.type]: repositoryUpdated,
  [repositoryRemoved.type]: repositoryRemoved,
  [repositoryPathSet.type]: repositoryPathSet,
  [cardCreated.type]: cardCreated,
  [cardUpdated.type]: cardUpdated,
  [cardAssigned.type]: cardAssigned,
  [cardStatusChanged.type]: cardStatusChanged,
  [cardLabelsChanged.type]: cardLabelsChanged,
  [labelCreated.type]: labelCreated,
  [labelUpdated.type]: labelUpdated,
  [labelDeleted.type]: labelDeleted,
  [cardMoved.type]: cardMoved,
  [cardDeleted.type]: cardDeleted,
});

const [firstDescriptor, ...otherDescriptors] = Object.values(eventRegistry);
if (!firstDescriptor) throw new Error('The event registry must contain at least one event');
export const eventSchema = z.discriminatedUnion('type', [
  firstDescriptor.schema,
  ...otherDescriptors.map((descriptor) => descriptor.schema),
]);
export type KnownEvent = z.infer<typeof eventSchema>;

/** Server validation rejects unregistered types and invalid registered payloads. */
export function parseEvent(raw: unknown): KnownEvent {
  return eventSchema.parse(raw);
}

const clientActorSchema = actorSchema.extend({ kind: tolerantEnum(actorKinds) });

function clientSchemaFor(descriptor: (typeof eventRegistry)[keyof typeof eventRegistry]) {
  return descriptor.schema.extend({
    actor: clientActorSchema,
    // Validate JSON, then strip additive fields without relaxing known field validation.
    payload: z.json().pipe(descriptor.payloadSchema.strip()),
  });
}

const unknownEventSchema = eventEnvelopeSchema
  .extend({ actor: clientActorSchema })
  .refine(
    (event) => !Object.hasOwn(eventRegistry, event.type),
    'Expected an unregistered event type',
  )
  .transform((event) => ({ ...event, type: 'unknown' as const, originalType: event.type }));

export const clientEventSchema = z.union([
  z.discriminatedUnion('type', [
    clientSchemaFor(firstDescriptor),
    ...otherDescriptors.map(clientSchemaFor),
  ]),
  unknownEventSchema,
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type UnknownEvent = z.infer<typeof unknownEventSchema>;

/** Clients retain future types; malformed events are logged and skipped with null. */
export function parseClientEvent(raw: unknown, logger: ParseLogger): ClientEvent | null {
  return parseWithFallback(
    clientEventSchema.transform((event): ClientEvent | null => event),
    raw,
    null,
    logger,
  );
}

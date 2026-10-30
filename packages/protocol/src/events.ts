import { z } from 'zod';
import { timestampSchema } from './base.js';
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
export const eventRegistry = Object.freeze({
  [systemPing.type]: systemPing,
  [pairingChanged.type]: pairingChanged,
  [devicePaired.type]: devicePaired,
  [deviceUsed.type]: deviceUsed,
  [deviceRevoked.type]: deviceRevoked,
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

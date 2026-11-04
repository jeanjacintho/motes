import type {
  AssignCardBody,
  CardStatus,
  CreateLabelInput,
  Label,
  UpdateCardInput,
} from '@motes/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import { type CardsClient, cardKeys, labelKeys } from './cards.js';

type Labels = ReturnType<typeof createApiClient>['labels'];
export type LabelsClient<Calls extends keyof Labels = keyof Labels> = {
  labels: Pick<Labels, Calls>;
};

const noLabels: Label[] = [];

export const labelsQueryOptions = (client: LabelsClient<'list'>, projectId: string) => ({
  queryKey: labelKeys.project(projectId),
  queryFn: () => client.labels.list(projectId, noLabels),
});

/** The labels a project offers, in name order; labels events keep the list current. */
export function useLabels(client: LabelsClient<'list'>, projectId: string) {
  return useQuery(labelsQueryOptions(client, projectId));
}

export type CardDetailClient = CardsClient<
  'update' | 'assign' | 'move' | 'attachLabel' | 'detachLabel'
> &
  LabelsClient<'create'>;

/**
 * Every write the card detail makes. Each one refreshes the card and the project's boards when it
 * settles, so the screen is right even before the realtime event arrives.
 */
export function useCardActions(client: CardDetailClient, projectId: string, cardId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cardKeys.all }),
      queryClient.invalidateQueries({ queryKey: cardKeys.boards(projectId) }),
    ]);
  };
  const write = <Input>(call: (input: Input) => Promise<unknown>) =>
    useMutation({ mutationFn: call, onSettled: refresh });
  return {
    update: write((patch: UpdateCardInput) => client.cards.update(cardId, patch, null)),
    assign: write((assignee: AssignCardBody['assignee']) =>
      client.cards.assign(cardId, { assignee }, null),
    ),
    setStatus: write((status: CardStatus) => client.cards.move(cardId, { status }, null)),
    attachLabel: write((labelId: string) => client.cards.attachLabel(cardId, labelId, null)),
    detachLabel: write((labelId: string) => client.cards.detachLabel(cardId, labelId, null)),
    createLabel: useMutation({
      mutationFn: (input: CreateLabelInput) => client.labels.create(projectId, input, null),
      onSettled: () => queryClient.invalidateQueries({ queryKey: labelKeys.project(projectId) }),
    }),
  };
}

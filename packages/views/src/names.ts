import type { CardPriority, CardStatus } from '@motes/protocol';

export const statusNames: Record<CardStatus, string> = {
  backlog: 'Backlog',
  todo: 'A fazer',
  in_progress: 'Em andamento',
  in_review: 'Em revisão',
  done: 'Concluído',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
};

export const priorityNames: Record<CardPriority, string> = {
  none: 'Sem prioridade',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

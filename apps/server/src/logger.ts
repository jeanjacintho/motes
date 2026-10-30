import pino, { type DestinationStream, type LevelWithSilent } from 'pino';

export function createLogger(level: LevelWithSilent, destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: [
        'authorization',
        'token',
        'secret',
        'password',
        '*.authorization',
        '*.token',
        '*.secret',
        '*.password',
        '*.*.authorization',
        '*.*.token',
        '*.*.secret',
        '*.*.password',
      ],
    },
    destination,
  );
}

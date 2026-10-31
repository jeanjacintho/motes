import type { LiveSnapshot } from '../live';
import type { PairingRequest, PairingResult } from '../security';

declare global {
  interface Window {
    motes: {
      version(): Promise<string>;
      pairing(request: PairingRequest): Promise<PairingResult>;
      live: {
        snapshot(): Promise<LiveSnapshot>;
        subscribe(listener: (snapshot: unknown) => void): () => void;
      };
    };
  }
}

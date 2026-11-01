import type { ApiRequest, ApiResult } from '../api';
import type { LiveSnapshot } from '../live';
import type { PairingRequest, PairingResult } from '../security';

declare global {
  interface Window {
    motes: {
      version(): Promise<string>;
      pairing(request: PairingRequest): Promise<PairingResult>;
      api(request: ApiRequest): Promise<ApiResult>;
      live: {
        snapshot(): Promise<LiveSnapshot>;
        subscribe(listener: (snapshot: unknown) => void): () => void;
        subscribeInvalidations(listener: (queryKey: unknown) => void): () => void;
      };
    };
  }
}

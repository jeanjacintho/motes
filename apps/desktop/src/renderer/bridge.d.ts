import type { PairingRequest, PairingResult } from '../security';

declare global {
  interface Window {
    motes: { version(): Promise<string>; pairing(request: PairingRequest): Promise<PairingResult> };
  }
}

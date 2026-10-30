export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SecureStorageAdapter {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  removeToken(): Promise<void>;
}

export interface Notification {
  title: string;
  body: string;
}

export interface PlatformAdapter {
  notify(notification: Notification): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export function createMemoryStorageAdapter(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

export function createMemorySecureStorageAdapter(): SecureStorageAdapter {
  let token: string | null = null;
  return {
    async getToken() {
      return token;
    },
    async setToken(value) {
      token = value;
    },
    async removeToken() {
      token = null;
    },
  };
}

export function createMemoryPlatformAdapter(): PlatformAdapter & {
  notifications: Notification[];
  openedLinks: string[];
} {
  const notifications: Notification[] = [];
  const openedLinks: string[] = [];
  return {
    notifications,
    openedLinks,
    async notify(notification) {
      notifications.push({ ...notification });
    },
    async openExternal(url) {
      openedLinks.push(url);
    },
  };
}

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type Cipher = {
  generateKey(): Promise<string>;
  encrypt(value: string, key: string): Promise<string>;
  decrypt(value: string, key: string): Promise<string>;
};

export function sessionStorage(values: Storage, keys: Storage, cipher: Cipher): Storage {
  const keyName = (key: string) => 'lynxr.v1.' + key;
  return {
    async getItem(key) {
      const value = await values.getItem(keyName(key));
      if (!value) return null;
      const secret = await keys.getItem(keyName(key));
      if (!secret) return null; // Restored ciphertext without this device's Keychain/Keystore entry.
      try {
        return await cipher.decrypt(value, secret);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      const name = keyName(key);
      let secret = await keys.getItem(name);
      if (!secret) {
        secret = await cipher.generateKey();
        await keys.setItem(name, secret);
      }
      await values.setItem(name, await cipher.encrypt(value, secret));
    },
    async removeItem(key) {
      const name = keyName(key);
      await keys.removeItem(name);
      await values.removeItem(name);
    },
  };
}

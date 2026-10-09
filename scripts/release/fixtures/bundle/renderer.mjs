// The neutral factory alone: it must bring no adapter, React or Pixi code.
import { createRenderer } from '__RENDERER__';

export const result = () => ({ createRenderer: typeof createRenderer });

// Build-time switches of Kehrwasser (see data/index.ts).
interface ImportMetaEnv {
  /** "1" = show exercises that have no animation yet, also in a production build */
  readonly VITE_DEHNEN_ALL?: string;
}

// A module's stylesheet is imported beside it for its effect alone, and esbuild bundles every one into `renderer.css`; TypeScript refuses a side-effect import it has no declaration for.
declare module '*.css';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string | undefined;
    }
  }
}

export {};

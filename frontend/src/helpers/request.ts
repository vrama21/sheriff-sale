interface RequestProps {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  options?: Record<string, unknown>;
}

interface RequestType {
  data: unknown;
}

/**
 * Creates an http request to an url
 */
export const request = async ({ url, method, options }: RequestProps): Promise<RequestType | undefined> => {
  const defaultOption = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  try {
    const response = (await fetch(url, options || defaultOption)).json();

    return response;
  } catch (err) {
    console.error('fetch failed with: ', err);
  }
};

import { createContext, PropsWithChildren, useCallback, useContext, useState } from 'react';

type AppContextProps = {
  currentPage: number;
};

type SetAppContextProps = Partial<AppContextProps>;

interface AppContextRoot {
  appContext: AppContextProps;
  setAppContext: (context: SetAppContextProps) => void;
}

const appInitialState: AppContextRoot = {
  appContext: {
    currentPage: 0,
  },
  setAppContext: () => undefined,
};

const AppContext = createContext({ ...appInitialState });

export const AppContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState(appInitialState.appContext);

  const setAppContext = useCallback(
    (context: SetAppContextProps) => setState({ ...state, ...context }),
    [state, setState],
  );

  const getAppContext = useCallback(() => ({ appContext: state, setAppContext }), [state]);

  return <AppContext.Provider value={getAppContext()}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  return useContext(AppContext);
};

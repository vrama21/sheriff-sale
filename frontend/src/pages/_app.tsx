import type { NextPage } from 'next';
import type { AppProps, AppType } from 'next/app';
import type { ReactElement, ReactNode } from 'react';

import { LoadScript } from '@react-google-maps/api';
import '../styles/globals.css';
import { useStyles } from './_app.style';
import { ThemeProvider } from '@mui/material';
import theme from '../theme/theme';
import { createEmotionSsrAdvancedApproach } from 'tss-react/next';
import { trpc } from '../utils/trpc';

const { augmentDocumentWithEmotionCache, withAppEmotionCache } = createEmotionSsrAdvancedApproach({ key: 'css' });

export { augmentDocumentWithEmotionCache };

export type NextPageWithLayout<TProps = Record<string, unknown>, TInitialProps = TProps> = NextPage<
  TProps,
  TInitialProps
> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

const MyApp = (({ Component, pageProps }: AppPropsWithLayout) => {
  const { classes } = useStyles();

  const getLayout = Component.getLayout ?? ((page) => <div>{page}</div>);

  return getLayout(
    <Component {...pageProps}>
      <ThemeProvider theme={theme}>
        <div className={classes.container}>
          <LoadScript googleMapsApiKey={process.env.NEXT_GOOGLE_MAPS_API_KEY as string}>
            <Component {...pageProps} />
          </LoadScript>
        </div>
      </ThemeProvider>
    </Component>,
  );
}) as AppType;

export default trpc.withTRPC(withAppEmotionCache(MyApp));

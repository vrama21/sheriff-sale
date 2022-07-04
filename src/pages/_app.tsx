// src/pages/_app.tsx
import { withTRPC } from '@trpc/next';
import type { AppRouter } from '../server/router';
import type { AppType } from 'next/dist/shared/lib/utils';
import superjson from 'superjson';
import { LoadScript } from '@react-google-maps/api';
import '../styles/globals.css';
import { globalStyles } from './_app.style';
import { ThemeProvider } from '@material-ui/core/styles';
import theme from '../theme/theme';

const MyApp: AppType = ({ Component, pageProps }) => {
  const classes = globalStyles();

  return (
    <ThemeProvider theme={theme}>
      <div className={classes.container}>
        <LoadScript googleMapsApiKey={process.env.NEXT_GOOGLE_MAPS_API_KEY as string}>
          <Component {...pageProps} />
        </LoadScript>
      </div>
    </ThemeProvider>
  );
};

const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return '';
  }
  if (process.browser) return ''; // Browser should use current path
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url

  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

export default withTRPC<AppRouter>({
  config({ ctx }) {
    /**
     * If you want to use SSR, you need to use the server's full URL
     * @link https://trpc.io/docs/ssr
     */
    const url = `${getBaseUrl()}/api/trpc`;

    return {
      url,
      transformer: superjson,
      /**
       * @link https://react-query.tanstack.com/reference/QueryClient
       */
      // queryClientConfig: { defaultOptions: { queries: { staleTime: 60 } } },
    };
  },
  /**
   * @link https://trpc.io/docs/ssr
   */
  ssr: false,
})(MyApp);

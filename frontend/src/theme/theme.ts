import { colors, unstable_createMuiStrictModeTheme as createMuiTheme } from '@mui/material';

export default createMuiTheme({
  palette: {
    common: {
      black: '#121212',
    },
    primary: {
      light: '#6487B4',
      main: '#1DDECB',
      dark: '#08423C',
      contrastText: colors.common.white,
    },
    secondary: {
      light: '#B5D2E3',
      main: '#bac9cc',
      dark: '#4A92BC',
      contrastText: colors.common.white,
    },
    success: {
      light: '#A5C8B7',
      main: '#81B29A',
      dark: '#53886E',
    },
    warning: {
      light: '#E9A28E',
      main: '#E07A5F',
      dark: '#C14725',
    },
    // type: 'dark',
  },
});

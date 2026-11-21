import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * Identidade da Mercearia Saudável, tirada da logomarca:
 * terracota (#B74733, letras e parênteses) e laranja (#E89823, o símbolo),
 * sobre creme, com texto em marrom café. Títulos em serifa (Fraunces),
 * texto corrido em DM Sans. As telas usam os nomes, não as cores.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#B74733', dark: '#8E3426', soft: '#F6E8DA', accent: '#E89823' },
        sun: { DEFAULT: '#E89823', dark: '#B9730F', soft: '#FCEBCF' },
        cream: { DEFAULT: '#FBF6EE', dark: '#F2E8DA' },
        ink: { DEFAULT: '#2B1E18', soft: '#7A665B' },
        // Cinzas quentes (pedra) no lugar dos cinzas azulados, em todas as telas.
        slate: colors.stone,
        gray: colors.stone,
      },
      fontFamily: {
        sans: ['"DM Sans Variable"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
      },
      borderRadius: { card: '14px' },
    },
  },
} satisfies Config;

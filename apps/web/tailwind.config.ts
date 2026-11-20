import type { Config } from 'tailwindcss';

/**
 * Paleta provisória do Mercearia (azul-petróleo + ciano, cara de ótica). Quando
 * a identidade visual sair, troca só aqui: as telas usam os nomes, não as cores.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0B3B4F', dark: '#072836', soft: '#E6F1F4', accent: '#5CE1E6' },
        ink: { DEFAULT: '#14232B', soft: '#5B6B73' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '12px' },
    },
  },
} satisfies Config;

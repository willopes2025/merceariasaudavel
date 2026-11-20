import type { Config } from 'tailwindcss';

/**
 * Paleta da Mercearia Saudável (verde-folha + verde-limão, a mesma da apresentação). Quando
 * a identidade visual sair, troca só aqui: as telas usam os nomes, não as cores.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#2F6B3A', dark: '#1F4A27', soft: '#E8F2E4', accent: '#B8E06A' },
        ink: { DEFAULT: '#14232B', soft: '#5B6B73' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '12px' },
    },
  },
} satisfies Config;

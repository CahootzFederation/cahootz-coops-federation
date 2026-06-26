const { hairlineWidth } = require('nativewind/theme');
 
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],

  presets: [require("nativewind/preset")],
  darkMode: 'class',
  safelist: [
    // Safelist dynamic coop background colors
    'bg-red-700',
    'bg-red-800',
    'bg-red-900',
    'bg-purple-700',
    'bg-purple-800',
    'bg-purple-900',
    'bg-blue-700',
    'bg-blue-800',
    'bg-blue-900',
    'bg-gold-600',
    'bg-gold-700',
    'bg-purple-600',
    'bg-blue-600',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Cahootz Brand Colors
        gold: {
          50: 'hsl(var(--gold-50))',
          100: 'hsl(var(--gold-100))',
          200: 'hsl(var(--gold-200))',
          300: 'hsl(var(--gold-300))',
          400: 'hsl(var(--gold-400))',
          500: 'hsl(var(--gold-500))',
          600: 'hsl(var(--gold-600))',
          700: 'hsl(var(--gold-700))',
          800: 'hsl(var(--gold-800))',
          900: 'hsl(var(--gold-900))',
        },
        red: {
          50: 'hsl(var(--red-50))',
          100: 'hsl(var(--red-100))',
          200: 'hsl(var(--red-200))',
          300: 'hsl(var(--red-300))',
          400: 'hsl(var(--red-400))',
          500: 'hsl(var(--red-500))',
          600: 'hsl(var(--red-600))',
          700: 'hsl(var(--red-700))',
          800: 'hsl(var(--red-800))',
          900: 'hsl(var(--red-900))',
        },
        charcoal: {
          50: 'hsl(var(--charcoal-50))',
          100: 'hsl(var(--charcoal-100))',
          200: 'hsl(var(--charcoal-200))',
          300: 'hsl(var(--charcoal-300))',
          400: 'hsl(var(--charcoal-400))',
          500: 'hsl(var(--charcoal-500))',
          600: 'hsl(var(--charcoal-600))',
          700: 'hsl(var(--charcoal-700))',
          800: 'hsl(var(--charcoal-800))',
          900: 'hsl(var(--charcoal-900))',
        },
        cream: {
          50: 'hsl(var(--cream-50))',
          100: 'hsl(var(--cream-100))',
          200: 'hsl(var(--cream-200))',
          300: 'hsl(var(--cream-300))',
          400: 'hsl(var(--cream-400))',
          500: 'hsl(var(--cream-500))',
          600: 'hsl(var(--cream-600))',
          700: 'hsl(var(--cream-700))',
          800: 'hsl(var(--cream-800))',
          900: 'hsl(var(--cream-900))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require('tailwindcss-animate')]
}


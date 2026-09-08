/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Extra-small breakpoint for narrow phones / captive-portal popups
        xs: "380px",
      },
      colors: {
        // Burger & Sauce palette: bold black & white, warm paper background.
        // Fixed values — the guest splash page is always light.
        bnsblack: "#0a0a0a",
        bnspaper: "#f5f4f0",
        bnsgrey: "#6b6b6b",

        // Admin theme tokens. These flip between light and dark in
        // globals.css, so `text-ink/50` is readable either way.
        //   ink     – foreground (near-white on dark, near-black on light)
        //   surface – page background
        //   panel   – raised background: inputs, drawers, the sidebar
        // The whole admin UI is built from ink-over-surface at low alpha,
        // which is exactly what makes a single swap invert it cleanly.
        ink: "rgb(var(--ink) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",

        // Status accents. The translucent backgrounds work on both themes;
        // only the text needs a darker shade in light mode.
        good: "rgb(var(--good) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
      },
      boxShadow: {
        card: "0 10px 30px rgba(0, 0, 0, 0.10)",
      },
    },
  },
  plugins: [],
};

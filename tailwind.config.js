/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Burger & Sauce palette: bold black & white, warm paper background
        bnsblack: "#0a0a0a",
        bnspaper: "#f5f4f0",
        bnsgrey: "#6b6b6b",
      },
      boxShadow: {
        card: "0 10px 30px rgba(0, 0, 0, 0.10)",
      },
    },
  },
  plugins: [],
};

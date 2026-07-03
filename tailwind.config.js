/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        night: "#0a0a14",
        panel: "#12121f",
        glowviolet: "#8b5cf6",
        glowcyan: "#22d3ee",
        glowpink: "#e879f9",
      },
      boxShadow: {
        glow: "0 0 40px rgba(139, 92, 246, 0.35)",
        glowsm: "0 0 18px rgba(34, 211, 238, 0.25)",
      },
      backgroundImage: {
        "glow-gradient": "linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)",
      },
    },
  },
  plugins: [],
};

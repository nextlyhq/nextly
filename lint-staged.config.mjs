export default {
  '*.{js,jsx,ts,tsx}': (files) => [
    `eslint --fix ${files.map((f) => JSON.stringify(f)).join(' ')}`,
    `prettier --write ${files.map((f) => JSON.stringify(f)).join(' ')}`,
  ],
  '*.{json,css,scss,md}': 'prettier --write',
}

export default {
  '*.{js,jsx,ts,tsx}': (files) => [
    `eslint --fix ${files.join(' ')}`,
    `prettier --write ${files.join(' ')}`,
  ],
  '*.{json,css,scss,md}': 'prettier --write',
}

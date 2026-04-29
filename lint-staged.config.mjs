const EXCLUDED = ['packages/create-nextly-app', 'packages/nextly']

export default {
  '*.{js,jsx,ts,tsx}': (files) => {
    const filtered = files.filter(
      (f) => !EXCLUDED.some((pkg) => f.includes(`/${pkg}/`))
    )
    if (filtered.length === 0) return []
    return [
      `eslint --fix ${filtered.join(' ')}`,
      `prettier --write ${filtered.join(' ')}`,
    ]
  },
  '*.{json,css,scss,md}': 'prettier --write',
}

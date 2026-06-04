import nextConfig from 'eslint-config-next'

// Extract the @typescript-eslint plugin from the next/typescript block so we
// can reference it in our own rules object (flat config requires plugin to be
// in the same config entry as its rules).
const tsBlock = nextConfig.find((c) => c.name === 'next/typescript')
const tsPlugin = tsBlock?.plugins?.['@typescript-eslint']

const eslintConfig = [
  ...nextConfig,
  ...(tsPlugin
    ? [
        {
          plugins: { '@typescript-eslint': tsPlugin },
          rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
              'warn',
              {
                vars: 'all',
                args: 'after-used',
                ignoreRestSiblings: false,
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^(_|ignore)',
              },
            ],
          },
        },
      ]
    : []),
  {
    ignores: ['.next/', 'src/payload-types.ts', 'src/payload-generated-schema.ts'],
  },
]

export default eslintConfig

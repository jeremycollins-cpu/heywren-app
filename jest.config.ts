import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'jsdom',

  // Use SWC for fast TypeScript transpilation
  transform: {
    '^.+\\.(ts|tsx)$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: true,
          },
          transform: {
            react: {
              runtime: 'automatic',
            },
          },
        },
      },
    ],
  },

  // Path aliases matching tsconfig paths
  moduleNameMapper: {
    // Handle @/* path alias
    '^@/(.*)$': '<rootDir>/$1',

    // Handle CSS modules and plain CSS imports
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.ts',

    // Handle image imports
    '\\.(jpg|jpeg|png|gif|webp|avif|ico|bmp|svg)$':
      '<rootDir>/__mocks__/fileMock.ts',

    // Mock next/image
    '^next/image$': '<rootDir>/__mocks__/next-image.tsx',
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Coverage configuration
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.{ts,tsx}',
    '**/*.test.{ts,tsx}',
  ],

  // Exclude
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  transformIgnorePatterns: ['/node_modules/(?!(@supabase)/)'],

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
}

export default config

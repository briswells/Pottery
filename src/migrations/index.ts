import * as migration_20260615_014741_initial from './20260615_014741_initial';

export const migrations = [
  {
    up: migration_20260615_014741_initial.up,
    down: migration_20260615_014741_initial.down,
    name: '20260615_014741_initial'
  },
];

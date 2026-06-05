import * as migration_20260605_034229_initial from './20260605_034229_initial';

export const migrations = [
  {
    up: migration_20260605_034229_initial.up,
    down: migration_20260605_034229_initial.down,
    name: '20260605_034229_initial'
  },
];

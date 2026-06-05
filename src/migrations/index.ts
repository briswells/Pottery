import * as migration_20260605_034229_initial from './20260605_034229_initial';
import * as migration_20260605_174206_firings from './20260605_174206_firings';

export const migrations = [
  {
    up: migration_20260605_034229_initial.up,
    down: migration_20260605_034229_initial.down,
    name: '20260605_034229_initial',
  },
  {
    up: migration_20260605_174206_firings.up,
    down: migration_20260605_174206_firings.down,
    name: '20260605_174206_firings'
  },
];

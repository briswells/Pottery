import * as migration_20260615_014741_initial from './20260615_014741_initial';
import * as migration_20260615_031634_remove_category_add_number_of_classes from './20260615_031634_remove_category_add_number_of_classes';
import * as migration_20260615_150249_add_default_number_of_classes from './20260615_150249_add_default_number_of_classes';

export const migrations = [
  {
    up: migration_20260615_014741_initial.up,
    down: migration_20260615_014741_initial.down,
    name: '20260615_014741_initial',
  },
  {
    up: migration_20260615_031634_remove_category_add_number_of_classes.up,
    down: migration_20260615_031634_remove_category_add_number_of_classes.down,
    name: '20260615_031634_remove_category_add_number_of_classes',
  },
  {
    up: migration_20260615_150249_add_default_number_of_classes.up,
    down: migration_20260615_150249_add_default_number_of_classes.down,
    name: '20260615_150249_add_default_number_of_classes'
  },
];

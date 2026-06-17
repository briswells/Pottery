import * as migration_20260615_014741_initial from './20260615_014741_initial';
import * as migration_20260615_031634_remove_category_add_number_of_classes from './20260615_031634_remove_category_add_number_of_classes';
import * as migration_20260615_150249_add_default_number_of_classes from './20260615_150249_add_default_number_of_classes';
import * as migration_20260615_153003_add_favicon_to_site_settings from './20260615_153003_add_favicon_to_site_settings';
import * as migration_20260615_194316_add_homepage_card_images from './20260615_194316_add_homepage_card_images';
import * as migration_20260616_222948_add_include_in_gallery from './20260616_222948_add_include_in_gallery';
import * as migration_20260616_224012_add_firing_completed_at from './20260616_224012_add_firing_completed_at';

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
    name: '20260615_150249_add_default_number_of_classes',
  },
  {
    up: migration_20260615_153003_add_favicon_to_site_settings.up,
    down: migration_20260615_153003_add_favicon_to_site_settings.down,
    name: '20260615_153003_add_favicon_to_site_settings',
  },
  {
    up: migration_20260615_194316_add_homepage_card_images.up,
    down: migration_20260615_194316_add_homepage_card_images.down,
    name: '20260615_194316_add_homepage_card_images',
  },
  {
    up: migration_20260616_222948_add_include_in_gallery.up,
    down: migration_20260616_222948_add_include_in_gallery.down,
    name: '20260616_222948_add_include_in_gallery',
  },
  {
    up: migration_20260616_224012_add_firing_completed_at.up,
    down: migration_20260616_224012_add_firing_completed_at.down,
    name: '20260616_224012_add_firing_completed_at'
  },
];

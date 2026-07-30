ALTER TABLE `shopper_list_items` ADD `updated_at` integer;
--> statement-breakpoint
UPDATE `shopper_list_items` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
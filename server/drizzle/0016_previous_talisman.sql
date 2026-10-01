ALTER TABLE `briefing_runs` ADD `lead_ids` text;--> statement-breakpoint
ALTER TABLE `user_file_state` ADD `read_items` text;--> statement-breakpoint
-- v0.43: 회차 파일은 트리에서 빠지고 최상위에 놓인다 — v0.42 월별 폴더(뉴스 브리핑/YYYY-MM)의 회차를 꺼낸다
UPDATE `files` SET `folder_id` = NULL WHERE `kind` = 'briefing' AND `folder_id` IS NOT NULL;--> statement-breakpoint
-- 비게 된 월별 폴더만 지운다. 폴더 삭제는 안의 파일까지 cascade로 지우므로, 휴지통 것까지 포함해 파일·하위 폴더가 하나도 없을 때만
DELETE FROM `folders`
WHERE `name` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
  AND `parent_id` IN (SELECT `id` FROM `folders` WHERE `name` = '뉴스 브리핑' AND `parent_id` IS NULL)
  AND NOT EXISTS (SELECT 1 FROM `files` WHERE `files`.`folder_id` = `folders`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `folders` AS `sub` WHERE `sub`.`parent_id` = `folders`.`id`);

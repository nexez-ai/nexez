-- Protocol 4 excludes discontinued-hosting and registrar holding pages.
-- Retain every frozen cohort, active cap and materialized claim unchanged.
-- This migration does not enable scanning or alter customer scan behavior.
begin;
set local lock_timeout = '5s';
alter table public.study_runs drop constraint study_runs_research_protocol_version_check;
alter table public.study_runs add constraint study_runs_research_protocol_version_check
  check (research_protocol_version in (1,2,3,4));
commit;

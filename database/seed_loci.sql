--
-- PostgreSQL database dump
--

\restrict hx8dOJp2O6Vopsxyi3T4gfbzb9rKXjrv4qo24KwyoKnKZKdbmADgRgY4XwY9GiS

-- Dumped from database version 15.19
-- Dumped by pg_dump version 15.19

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: str_loci_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (1, 'D3S1358', 1, true, 'STR locus D3S1358');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (2, 'vWA', 2, true, 'von Willebrand factor A');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (3, 'D16S539', 3, true, 'STR locus D16S539');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (4, 'CSF1PO', 4, true, 'c-fms proto-oncogene for CSF-1 receptor');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (5, 'TPOX', 5, true, 'Thyroid peroxidase');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (6, 'D8S1179', 6, true, 'STR locus D8S1179');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (7, 'D21S11', 7, true, 'STR locus D21S11');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (8, 'D18S51', 8, true, 'STR locus D18S51');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (9, 'D2S441', 9, true, 'STR locus D2S441');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (10, 'D19S433', 10, true, 'STR locus D19S433');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (11, 'TH01', 11, true, 'Tyrosine hydroxylase');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (12, 'FGA', 12, true, 'Fibrinogen alpha chain');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (13, 'D22S1045', 13, true, 'STR locus D22S1045');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (14, 'D5S818', 14, true, 'STR locus D5S818');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (15, 'D13S317', 15, true, 'STR locus D13S317');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (16, 'D7S820', 16, true, 'STR locus D7S820');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (17, 'D6S1043', 17, true, 'STR locus D6S1043');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (18, 'D10S1248', 18, true, 'STR locus D10S1248');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (19, 'D1S1656', 19, true, 'STR locus D1S1656');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (20, 'D12S391', 20, true, 'STR locus D12S391');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (21, 'D2S1338', 21, true, 'STR locus D2S1338');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (22, 'AMEL', 22, true, 'Amelogenin');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (23, 'D9S1122', 23, true, 'STR locus D9S1122');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (24, 'D18S853', 24, true, 'STR locus D18S853');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (25, 'D17S906', 25, true, 'STR locus D17S906');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (26, 'D4S2408', 26, true, 'STR locus D4S2408');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (27, 'D8S1132', 27, true, 'STR locus D8S1132');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (28, 'D1S1677', 28, true, 'STR locus D1S1677');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (29, 'D20S482', 29, true, 'STR locus D20S482');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (30, 'D14S1434', 30, true, 'STR locus D14S1434');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (31, 'D11S4463', 31, true, 'STR locus D11S4463');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (32, 'D15S659', 32, true, 'STR locus D15S659');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (33, 'D3S4529', 33, true, 'STR locus D3S4529');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (34, 'D16S753', 34, true, 'STR locus D16S753');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (35, 'D17S1301', 35, true, 'STR locus D17S1301');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (36, 'D18S1364', 36, true, 'STR locus D18S1364');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (37, 'D2S1776', 37, true, 'STR locus D2S1776');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (38, 'D4S2366', 38, true, 'STR locus D4S2366');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (39, 'D1S1627', 39, true, 'STR locus D1S1627');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (40, 'rs2032678', 40, true, 'SNP marker rs2032678 - Extended analysis marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (42, 'Penta E', 41, true, 'Pentanucleotide repeat marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (43, 'Penta D', 42, true, 'Pentanucleotide repeat marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (44, 'D10S1435', 43, true, 'STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (45, 'D19S253', 44, true, 'STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (46, 'D3S3045', 45, true, 'STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (47, 'D6S477', 46, true, 'STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (48, 'DXS6795', 47, true, 'X-chromosome STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (49, 'DYS391', 48, true, 'Y-chromosome STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (50, 'SE33', 49, true, 'STR marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (51, 'Yindel', 50, true, 'Y-chromosome indel marker');
INSERT INTO public.str_loci_config (id, locus_name, display_order, is_active, description) VALUES (52, 'rs771783753', 51, true, 'SNP marker');


--
-- Name: str_loci_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.str_loci_config_id_seq', 52, true);


--
-- PostgreSQL database dump complete
--

\unrestrict hx8dOJp2O6Vopsxyi3T4gfbzb9rKXjrv4qo24KwyoKnKZKdbmADgRgY4XwY9GiS


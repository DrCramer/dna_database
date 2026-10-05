--
-- PostgreSQL database dump
--

\restrict UdtYm5R8ZnYfLTJwFpuPcLbQtvzf486KAwzkhpxYqJsPAgLjCImRmfHZP7ittxi

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
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: log_audit_event(uuid, character varying, uuid, character varying, jsonb, jsonb, inet, text, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_audit_event(p_user_id uuid, p_table_name character varying, p_record_id uuid, p_action character varying, p_old_values jsonb, p_new_values jsonb, p_ip_address inet, p_user_agent text, p_session_id character varying, p_compliance_level character varying) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    audit_id UUID;
BEGIN
    INSERT INTO audit_logs (
        user_id, table_name, record_id, action, old_values, new_values,
        ip_address, user_agent, session_id, compliance_level
    ) VALUES (
        p_user_id, p_table_name, p_record_id, p_action, p_old_values, p_new_values,
        p_ip_address, p_user_agent, p_session_id, p_compliance_level
    ) RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$;


--
-- Name: log_compliance_event(character varying, character varying, text, character varying, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_compliance_event(p_event_type character varying, p_severity character varying, p_description text, p_affected_table character varying, p_affected_record_id uuid, p_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO compliance_events (
        event_type, severity, description, affected_table, affected_record_id, user_id
    ) VALUES (
        p_event_type, p_severity, p_description, p_affected_table, p_affected_record_id, p_user_id
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$;


--
-- Name: log_data_access(uuid, character varying, uuid, character varying, boolean, text, inet, text, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_data_access(p_user_id uuid, p_resource_type character varying, p_resource_id uuid, p_access_type character varying, p_access_granted boolean, p_denial_reason text, p_ip_address inet, p_user_agent text, p_session_id character varying, p_data_classification character varying) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    access_log_id UUID;
BEGIN
    INSERT INTO data_access_log (
        user_id, resource_type, resource_id, access_type, access_granted,
        denial_reason, ip_address, user_agent, session_id, data_classification
    ) VALUES (
        p_user_id, p_resource_type, p_resource_id, p_access_type, p_access_granted,
        p_denial_reason, p_ip_address, p_user_agent, p_session_id, p_data_classification
    ) RETURNING id INTO access_log_id;
    
    RETURN access_log_id;
END;
$$;


--
-- Name: secure_delete_record(character varying, uuid, text, uuid, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.secure_delete_record(p_table_name character varying, p_record_id uuid, p_deletion_reason text, p_deleted_by uuid, p_deletion_method character varying) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    verification_hash VARCHAR(255);
    success BOOLEAN := false;
BEGIN
    -- Generate verification hash
    verification_hash := encode(digest(p_table_name || p_record_id::text || p_deletion_reason || now()::text, 'sha256'), 'hex');
    
    -- Log the deletion
    INSERT INTO secure_deletion_log (
        table_name, record_id, deletion_method, deletion_reason, deleted_by, verification_hash
    ) VALUES (
        p_table_name, p_record_id, p_deletion_method, p_deletion_reason, p_deleted_by, verification_hash
    );
    
    -- For testing purposes, we'll just log the deletion without actually deleting data
    -- In production, this would perform the actual deletion based on deletion_method
    success := true;
    
    RETURN success;
END;
$$;


--
-- Name: update_task_status(uuid, character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_task_status(p_task_id uuid, p_new_status character varying, p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_status VARCHAR(20);
    task_department_id UUID;
    user_department_id UUID;
    user_role VARCHAR(20);
    task_assigned_user UUID;
    task_assigned_group UUID;
    is_group_member BOOLEAN := false;
BEGIN
    -- Get task details
    SELECT status, department_id, assigned_to_user, assigned_to_group
    INTO current_status, task_department_id, task_assigned_user, task_assigned_group
    FROM tasks WHERE id = p_task_id;
    
    -- Get user details
    SELECT department_id, role INTO user_department_id, user_role
    FROM users WHERE id = p_user_id;
    
    -- Check if user is assigned to task or is group member
    IF task_assigned_user = p_user_id THEN
        -- User is directly assigned
        NULL;
    ELSIF task_assigned_group IS NOT NULL THEN
        -- Check if user is member of assigned group
        SELECT EXISTS(
            SELECT 1 FROM expert_group_members 
            WHERE group_id = task_assigned_group AND user_id = p_user_id AND is_active = true
        ) INTO is_group_member;
        
        IF NOT is_group_member AND user_role NOT IN ('department_head', 'system_administrator', 'admin') THEN
            RETURN false;
        END IF;
    ELSIF user_role NOT IN ('department_head', 'system_administrator', 'admin') THEN
        RETURN false;
    END IF;
    
    -- Validate status transition
    IF (current_status = 'assigned' AND p_new_status IN ('in_progress', 'completed')) OR
       (current_status = 'in_progress' AND p_new_status IN ('completed', 'assigned')) OR
       (current_status = 'completed' AND p_new_status = 'approved' AND user_role IN ('department_head', 'system_administrator', 'admin')) THEN
        
        -- Update task status
        UPDATE tasks 
        SET status = p_new_status, 
            updated_at = CURRENT_TIMESTAMP,
            started_at = CASE WHEN p_new_status = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
            completed_at = CASE WHEN p_new_status = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END,
            approved_at = CASE WHEN p_new_status = 'approved' AND approved_at IS NULL THEN CURRENT_TIMESTAMP ELSE approved_at END,
            approved_by = CASE WHEN p_new_status = 'approved' THEN p_user_id ELSE approved_by END
        WHERE id = p_task_id;
        
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: staff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id character varying(50) NOT NULL,
    full_name character varying(200) NOT NULL,
    department character varying(100),
    "position" character varying(100),
    str_data jsonb NOT NULL,
    date_added timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    notes text,
    created_by uuid,
    CONSTRAINT staff_profiles_str_data_check CHECK ((jsonb_typeof(str_data) = 'object'::text))
);


--
-- Name: TABLE staff_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.staff_profiles IS 'Профили сотрудников для анализа контаминации';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(20) DEFAULT 'analyst'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_login timestamp without time zone,
    is_active boolean DEFAULT true,
    can_upload_with_task boolean DEFAULT true NOT NULL,
    can_upload_without_task boolean DEFAULT false NOT NULL,
    organization_id uuid,
    department_id uuid,
    email_encrypted text,
    personal_info_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('analyst'::character varying)::text, ('viewer'::character varying)::text, ('system_administrator'::character varying)::text, ('department_head'::character varying)::text, ('user_analyst'::character varying)::text])))
);


--
-- Name: active_staff_profiles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_staff_profiles AS
 SELECT sp.id,
    sp.staff_id,
    sp.full_name,
    sp.department,
    sp."position",
    sp.str_data,
    sp.date_added,
    sp.last_updated,
    sp.is_active,
    sp.notes,
    sp.created_by,
    u.username AS created_by_username
   FROM (public.staff_profiles sp
     LEFT JOIN public.users u ON ((sp.created_by = u.id)))
  WHERE (sp.is_active = true);


--
-- Name: allele_frequencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allele_frequencies (
    id integer NOT NULL,
    locus character varying(50) NOT NULL,
    allele character varying(50) NOT NULL,
    frequency numeric(10,8) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: allele_frequencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.allele_frequencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: allele_frequencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.allele_frequencies_id_seq OWNED BY public.allele_frequencies.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    table_name character varying(50) NOT NULL,
    record_id uuid,
    action character varying(20) NOT NULL,
    old_values jsonb,
    new_values jsonb,
    changed_fields text[],
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text,
    session_id character varying(255),
    request_id character varying(255),
    compliance_level character varying(20) DEFAULT 'standard'::character varying,
    CONSTRAINT audit_logs_action_check CHECK (((action)::text = ANY (ARRAY[('INSERT'::character varying)::text, ('UPDATE'::character varying)::text, ('DELETE'::character varying)::text, ('SELECT'::character varying)::text]))),
    CONSTRAINT audit_logs_compliance_level_check CHECK (((compliance_level)::text = ANY (ARRAY[('standard'::character varying)::text, ('high'::character varying)::text, ('critical'::character varying)::text])))
);


--
-- Name: bayesian_analysis_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bayesian_analysis_results (
    id integer NOT NULL,
    analysis_type character varying(20) NOT NULL,
    profile1_id uuid NOT NULL,
    profile2_id uuid,
    result_data jsonb NOT NULL,
    population_used character varying(50),
    parameters_used jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone,
    created_by uuid,
    CONSTRAINT bayesian_analysis_results_analysis_type_check CHECK (((analysis_type)::text = ANY (ARRAY[('LR'::character varying)::text, ('contamination'::character varying)::text, ('degradation'::character varying)::text, ('duplicate'::character varying)::text])))
);


--
-- Name: bayesian_analysis_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bayesian_analysis_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bayesian_analysis_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bayesian_analysis_results_id_seq OWNED BY public.bayesian_analysis_results.id;


--
-- Name: comment_edit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_edit_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comment_id uuid NOT NULL,
    previous_comment text NOT NULL,
    edited_by uuid NOT NULL,
    edited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE comment_edit_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.comment_edit_history IS 'Stores edit history for task comments to maintain audit trail';


--
-- Name: compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(50) NOT NULL,
    severity character varying(20) DEFAULT 'info'::character varying,
    description text NOT NULL,
    affected_table character varying(50),
    affected_record_id uuid,
    user_id uuid,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    resolved boolean DEFAULT false,
    resolution_notes text,
    resolved_by uuid,
    resolved_at timestamp without time zone,
    CONSTRAINT compliance_events_severity_check CHECK (((severity)::text = ANY (ARRAY[('info'::character varying)::text, ('warning'::character varying)::text, ('error'::character varying)::text, ('critical'::character varying)::text])))
);


--
-- Name: contamination_analysis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contamination_analysis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sample_profile_id uuid,
    staff_profile_id uuid,
    contamination_percentage numeric(5,2) NOT NULL,
    locus_matches jsonb NOT NULL,
    analysis_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    analyzed_by uuid,
    analysis_method character varying(50) DEFAULT 'bayesian'::character varying,
    confidence_level numeric(5,2),
    notes text
);


--
-- Name: TABLE contamination_analysis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contamination_analysis IS 'Результаты анализа контаминации образцов с профилями сотрудников';


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    master_array_id uuid,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: dna_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dna_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    year integer,
    import_format character varying(20) DEFAULT 'emergency'::character varying NOT NULL,
    department_id uuid,
    organization_id uuid,
    sample_name character varying(100) NOT NULL,
    import_number character varying(255),
    internal_number character varying(100),
    str_data jsonb NOT NULL,
    upload_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    file_source text,
    notes text,
    is_active boolean DEFAULT true,
    master_array_id uuid,
    profile_type character varying(20) DEFAULT 'user'::character varying,
    str_data_encrypted text,
    sample_name_encrypted text,
    notes_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone,
    task_id uuid,
    deactivated_by uuid,
    deactivated_at timestamp without time zone,
    deactivation_reason text,
    expert_comment text,
    comment_updated_at timestamp without time zone,
    comment_updated_by uuid,
    CONSTRAINT dna_profiles_import_format_check CHECK (import_format IN ('emergency', 'genetic')),
    CONSTRAINT dna_profiles_import_year_check CHECK (year IS NOT NULL OR import_format = 'genetic'),
    CONSTRAINT dna_profiles_genetic_scope_check CHECK (import_format <> 'genetic' OR (department_id IS NOT NULL AND organization_id IS NOT NULL)),
    CONSTRAINT check_year_range CHECK (((year IS NULL) OR ((year >= 1900) AND (year <= 2100)))),
    CONSTRAINT dna_profiles_new_profile_type_check CHECK (((profile_type)::text = ANY (ARRAY[('user'::character varying)::text, ('master'::character varying)::text, ('staff'::character varying)::text])))
);


--
-- Name: COLUMN dna_profiles.deactivated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.deactivated_by IS 'User ID who deactivated this profile';


--
-- Name: COLUMN dna_profiles.deactivated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.deactivated_at IS 'Timestamp when profile was deactivated';


--
-- Name: COLUMN dna_profiles.deactivation_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.deactivation_reason IS 'Reason for deactivation';


--
-- Name: COLUMN dna_profiles.expert_comment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.expert_comment IS 'Expert comment about this profile';


--
-- Name: COLUMN dna_profiles.comment_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.comment_updated_at IS 'Last update timestamp for comment';


--
-- Name: COLUMN dna_profiles.comment_updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dna_profiles.comment_updated_by IS 'User ID who last updated the comment';


--
-- Name: profile_contamination_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_contamination_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference_profile_id uuid NOT NULL,
    matched_profile_id uuid NOT NULL,
    reference_sample_name character varying(255),
    reference_internal_number character varying(100),
    reference_import_number character varying(100),
    reference_year integer,
    matched_sample_name character varying(255),
    matched_internal_number character varying(100),
    matched_import_number character varying(100),
    matched_year integer,
    match_type character varying(50) NOT NULL,
    matching_loci_count integer NOT NULL,
    total_loci_compared integer NOT NULL,
    match_percentage numeric(5,2) NOT NULL,
    matched_loci jsonb,
    contaminated_loci jsonb,
    search_mode character varying(50),
    algorithm_used character varying(50),
    min_matches_threshold integer,
    ignored_loci text[],
    task_id uuid,
    department_id uuid,
    search_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    searched_by uuid
);


--
-- Name: TABLE profile_contamination_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profile_contamination_log IS 'Лог результатов поиска контаминации между профилями для статистики и анализа работы лаборатории';


--
-- Name: COLUMN profile_contamination_log.match_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile_contamination_log.match_type IS 'Тип совпадения: full_match (полное), partial_match (контаминация), no_match (нет совпадения)';


--
-- Name: COLUMN profile_contamination_log.search_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile_contamination_log.search_mode IS 'Режим поиска: task (в задаче), master_array (в мастер массиве), department_tasks (в задачах отдела), full_search (полный поиск)';


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    created_by uuid NOT NULL,
    assigned_to_user uuid,
    assigned_to_group uuid,
    title character varying(255) NOT NULL,
    description text,
    target_sample jsonb NOT NULL,
    data_source character varying(50) NOT NULL,
    data_source_id uuid,
    status character varying(20) DEFAULT 'assigned'::character varying,
    priority character varying(10) DEFAULT 'medium'::character varying,
    deadline timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    approved_at timestamp without time zone,
    approved_by uuid,
    is_active boolean DEFAULT true,
    target_sample_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone,
    internal_number_start character varying(50),
    internal_number_end character varying(50),
    cancelled_at timestamp without time zone,
    cancelled_by uuid,
    cancel_reason text,
    CONSTRAINT tasks_check CHECK (((assigned_to_user IS NOT NULL) OR (assigned_to_group IS NOT NULL))),
    CONSTRAINT tasks_data_source_check CHECK (((data_source)::text = ANY (ARRAY[('master_array'::character varying)::text, ('user_array'::character varying)::text, ('new_array'::character varying)::text]))),
    CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT tasks_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('assigned'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('approved'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: COLUMN tasks.internal_number_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.internal_number_start IS 'Начальный номер привоза (internal_number из genotypes)';


--
-- Name: COLUMN tasks.internal_number_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.internal_number_end IS 'Конечный номер привоза для диапазона (NULL если один номер)';


--
-- Name: COLUMN tasks.cancelled_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.cancelled_at IS 'Дата и время отмены задачи';


--
-- Name: COLUMN tasks.cancelled_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.cancelled_by IS 'ID пользователя, отменившего задачу';


--
-- Name: COLUMN tasks.cancel_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.cancel_reason IS 'Причина отмены задачи';


--
-- Name: contamination_log_detailed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contamination_log_detailed AS
 SELECT pcl.id,
    pcl.reference_profile_id,
    pcl.matched_profile_id,
    pcl.reference_sample_name,
    pcl.reference_internal_number,
    pcl.reference_import_number,
    pcl.reference_year,
    pcl.matched_sample_name,
    pcl.matched_internal_number,
    pcl.matched_import_number,
    pcl.matched_year,
    pcl.match_type,
    pcl.matching_loci_count,
    pcl.total_loci_compared,
    pcl.match_percentage,
    pcl.matched_loci,
    pcl.contaminated_loci,
    pcl.search_mode,
    pcl.algorithm_used,
    pcl.min_matches_threshold,
    pcl.ignored_loci,
    pcl.task_id,
    pcl.department_id,
    pcl.search_date,
    pcl.searched_by,
    ref_prof.sample_name AS ref_full_sample_name,
    match_prof.sample_name AS match_full_sample_name,
    t.title AS task_name,
    d.name AS department_name,
    u.username AS searched_by_username
   FROM (((((public.profile_contamination_log pcl
     LEFT JOIN public.dna_profiles ref_prof ON ((pcl.reference_profile_id = ref_prof.id)))
     LEFT JOIN public.dna_profiles match_prof ON ((pcl.matched_profile_id = match_prof.id)))
     LEFT JOIN public.tasks t ON ((pcl.task_id = t.id)))
     LEFT JOIN public.departments d ON ((pcl.department_id = d.id)))
     LEFT JOIN public.users u ON ((pcl.searched_by = u.id)))
  ORDER BY pcl.search_date DESC;


--
-- Name: contamination_stats_by_import; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contamination_stats_by_import AS
 SELECT profile_contamination_log.reference_import_number,
    profile_contamination_log.reference_year,
    count(*) AS total_searches,
    count(
        CASE
            WHEN ((profile_contamination_log.match_type)::text = 'full_match'::text) THEN 1
            ELSE NULL::integer
        END) AS full_matches,
    count(
        CASE
            WHEN ((profile_contamination_log.match_type)::text = 'partial_match'::text) THEN 1
            ELSE NULL::integer
        END) AS contaminations,
    avg(profile_contamination_log.match_percentage) AS avg_match_percentage,
    min(profile_contamination_log.search_date) AS first_search,
    max(profile_contamination_log.search_date) AS last_search
   FROM public.profile_contamination_log
  GROUP BY profile_contamination_log.reference_import_number, profile_contamination_log.reference_year
  ORDER BY profile_contamination_log.reference_year DESC, profile_contamination_log.reference_import_number DESC;


--
-- Name: contamination_stats_by_period; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contamination_stats_by_period AS
 SELECT date_trunc('month'::text, profile_contamination_log.search_date) AS period,
    count(*) AS total_searches,
    count(DISTINCT profile_contamination_log.reference_profile_id) AS unique_references,
    count(
        CASE
            WHEN ((profile_contamination_log.match_type)::text = 'full_match'::text) THEN 1
            ELSE NULL::integer
        END) AS full_matches,
    count(
        CASE
            WHEN ((profile_contamination_log.match_type)::text = 'partial_match'::text) THEN 1
            ELSE NULL::integer
        END) AS contaminations,
    avg(profile_contamination_log.match_percentage) AS avg_match_percentage,
    count(DISTINCT profile_contamination_log.searched_by) AS unique_users
   FROM public.profile_contamination_log
  GROUP BY (date_trunc('month'::text, profile_contamination_log.search_date))
  ORDER BY (date_trunc('month'::text, profile_contamination_log.search_date)) DESC;


--
-- Name: data_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_access_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    resource_type character varying(50) NOT NULL,
    resource_id uuid,
    access_type character varying(20) NOT NULL,
    access_granted boolean NOT NULL,
    denial_reason text,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text,
    session_id character varying(255),
    data_classification character varying(20) DEFAULT 'sensitive'::character varying,
    CONSTRAINT data_access_log_access_type_check CHECK (((access_type)::text = ANY (ARRAY[('read'::character varying)::text, ('write'::character varying)::text, ('delete'::character varying)::text, ('export'::character varying)::text, ('restricted'::character varying)::text, ('authenticate'::character varying)::text]))),
    CONSTRAINT data_access_log_data_classification_check CHECK (((data_classification)::text = ANY (ARRAY[('public'::character varying)::text, ('internal'::character varying)::text, ('sensitive'::character varying)::text, ('restricted'::character varying)::text])))
);


--
-- Name: data_retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_retention_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name character varying(50) NOT NULL,
    retention_period_days integer NOT NULL,
    deletion_method character varying(20) DEFAULT 'soft'::character varying,
    compliance_requirement character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    CONSTRAINT data_retention_policies_deletion_method_check CHECK (((deletion_method)::text = ANY (ARRAY[('soft'::character varying)::text, ('hard'::character varying)::text, ('archive'::character varying)::text]))),
    CONSTRAINT data_retention_policies_retention_period_days_check CHECK ((retention_period_days > 0))
);


--
-- Name: dept_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dept_count (
    count bigint
);


--
-- Name: duplicate_group_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.duplicate_group_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    group_identifier text NOT NULL,
    comment text NOT NULL,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE duplicate_group_comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.duplicate_group_comments IS 'Comments for duplicate groups in tasks';


--
-- Name: COLUMN duplicate_group_comments.group_identifier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.duplicate_group_comments.group_identifier IS 'Hash or identifier for the duplicate group';


--
-- Name: encryption_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encryption_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id uuid NOT NULL,
    operation character varying(50) NOT NULL,
    encryption_version integer NOT NULL,
    performed_by uuid,
    performed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    success boolean NOT NULL,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: encryption_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encryption_config (
    id integer NOT NULL,
    table_name character varying(100) NOT NULL,
    column_name character varying(100) NOT NULL,
    encryption_type character varying(50) DEFAULT 'aes-256-cbc'::character varying NOT NULL,
    key_rotation_interval integer DEFAULT 90,
    last_key_rotation timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: encryption_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.encryption_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: encryption_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.encryption_config_id_seq OWNED BY public.encryption_config.id;


--
-- Name: encryption_status_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.encryption_status_view AS
 SELECT ec.table_name,
    ec.column_name,
    ec.encryption_type,
    ec.key_rotation_interval,
    ec.last_key_rotation,
        CASE
            WHEN ((ec.last_key_rotation + ((ec.key_rotation_interval || ' days'::text))::interval) < CURRENT_TIMESTAMP) THEN true
            ELSE false
        END AS needs_rotation,
    ec.is_active,
    count(eal.id) AS total_operations,
    count(
        CASE
            WHEN (eal.success = false) THEN 1
            ELSE NULL::integer
        END) AS failed_operations,
    max(eal.performed_at) AS last_operation
   FROM (public.encryption_config ec
     LEFT JOIN public.encryption_audit_log eal ON (((ec.table_name)::text = (eal.table_name)::text)))
  GROUP BY ec.id, ec.table_name, ec.column_name, ec.encryption_type, ec.key_rotation_interval, ec.last_key_rotation, ec.is_active;


--
-- Name: expert_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid NOT NULL,
    added_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: expert_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_by uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: file_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    original_filename character varying(255) NOT NULL,
    stored_filename character varying(255) NOT NULL,
    file_size bigint NOT NULL,
    mime_type character varying(100) NOT NULL,
    upload_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    processing_status character varying(20) DEFAULT 'pending'::character varying,
    profiles_extracted integer DEFAULT 0,
    error_message text,
    CONSTRAINT file_uploads_processing_status_check CHECK (((processing_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: master_array_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_array_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_array_id uuid NOT NULL,
    year integer,
    sample_name character varying(255) NOT NULL,
    import_number character varying(100),
    internal_number character varying(100) NOT NULL,
    str_data jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    str_data_encrypted text,
    sample_name_encrypted text,
    metadata_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone,
    CONSTRAINT master_array_profiles_import_year_check CHECK (year IS NOT NULL OR COALESCE(metadata->>'importFormat', 'emergency') = 'genetic'),
    CONSTRAINT check_year_range_master CHECK (((year IS NULL) OR ((year >= 1900) AND (year <= 2100))))
);


--
-- Name: TABLE master_array_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.master_array_profiles IS 'Профили мастер массива. str_data хранит аллели в формате массивов для быстрого поиска с оператором ?|';


--
-- Name: master_arrays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_arrays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    expert_comment text,
    comment_updated_at timestamp without time zone,
    comment_updated_by uuid,
    original_deactivation_reason text
);


--
-- Name: COLUMN master_arrays.expert_comment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.master_arrays.expert_comment IS 'Expert comment transferred from dna_profiles';


--
-- Name: COLUMN master_arrays.comment_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.master_arrays.comment_updated_at IS 'Last update timestamp for comment';


--
-- Name: COLUMN master_arrays.comment_updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.master_arrays.comment_updated_by IS 'User ID who last updated the comment';


--
-- Name: COLUMN master_arrays.original_deactivation_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.master_arrays.original_deactivation_reason IS 'Historical deactivation reason if profile was deactivated then reactivated';


--
-- Name: match_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id_1 uuid,
    profile_id_2 uuid,
    overall_match_percentage numeric(5,2) NOT NULL,
    locus_matches jsonb NOT NULL,
    analysis_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    analyzed_by uuid,
    locus_matches_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone,
    CONSTRAINT match_results_check CHECK ((profile_id_1 <> profile_id_2)),
    CONSTRAINT match_results_overall_match_percentage_check CHECK (((overall_match_percentage >= (0)::numeric) AND (overall_match_percentage <= (100)::numeric)))
);


--
-- Name: operation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    operation_type character varying(50) NOT NULL,
    operation_details jsonb,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text,
    success boolean DEFAULT true,
    department_id uuid,
    affected_resources jsonb DEFAULT '{}'::jsonb
);


--
-- Name: COLUMN operation_history.department_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operation_history.department_id IS 'Department ID for organizational context and data isolation';


--
-- Name: COLUMN operation_history.affected_resources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operation_history.affected_resources IS 'JSON object containing information about resources affected by the operation';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: population_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.population_data (
    id integer NOT NULL,
    population_id character varying(50) NOT NULL,
    population_name character varying(100) NOT NULL,
    locus_name character varying(20) NOT NULL,
    allele character varying(20) NOT NULL,
    frequency numeric(10,8) NOT NULL,
    sample_size integer NOT NULL,
    inbreeding_coefficient numeric(5,4) DEFAULT 0.0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT population_data_frequency_check CHECK (((frequency >= (0)::numeric) AND (frequency <= (1)::numeric))),
    CONSTRAINT population_data_inbreeding_coefficient_check CHECK (((inbreeding_coefficient >= 0.0) AND (inbreeding_coefficient <= 0.3))),
    CONSTRAINT population_data_sample_size_check CHECK ((sample_size > 0))
);


--
-- Name: population_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.population_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: population_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.population_data_id_seq OWNED BY public.population_data.id;


--
-- Name: population_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.population_stats AS
 SELECT pd.population_id,
    pd.population_name,
    pd.locus_name,
    count(*) AS allele_count,
    min(pd.frequency) AS min_frequency,
    max(pd.frequency) AS max_frequency,
    avg(pd.frequency) AS avg_frequency,
    stddev(pd.frequency) AS frequency_stddev,
    pd.sample_size,
    pd.inbreeding_coefficient,
    max(pd.updated_at) AS last_updated
   FROM public.population_data pd
  GROUP BY pd.population_id, pd.population_name, pd.locus_name, pd.sample_size, pd.inbreeding_coefficient
  WITH NO DATA;


--
-- Name: population_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.population_summary AS
 SELECT population_data.population_id,
    population_data.population_name,
    count(DISTINCT population_data.locus_name) AS loci_count,
    count(*) AS total_alleles,
    avg(population_data.sample_size) AS avg_sample_size,
    avg(population_data.inbreeding_coefficient) AS avg_inbreeding_coeff,
    max(population_data.updated_at) AS last_updated
   FROM public.population_data
  GROUP BY population_data.population_id, population_data.population_name;


--
-- Name: profile_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_count (
    count bigint
);


--
-- Name: sample_quality_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_quality_metrics (
    id integer NOT NULL,
    sample_id character varying(50) NOT NULL,
    profile_id uuid,
    contamination_probability numeric(5,4),
    degradation_index numeric(5,4),
    quality_score numeric(5,4),
    flagged_loci text[],
    analysis_timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    population_used character varying(50),
    analysis_metadata jsonb,
    CONSTRAINT sample_quality_metrics_contamination_probability_check CHECK (((contamination_probability >= (0)::numeric) AND (contamination_probability <= (1)::numeric))),
    CONSTRAINT sample_quality_metrics_degradation_index_check CHECK (((degradation_index >= (0)::numeric) AND (degradation_index <= (1)::numeric))),
    CONSTRAINT sample_quality_metrics_quality_score_check CHECK (((quality_score >= (0)::numeric) AND (quality_score <= (1)::numeric)))
);


--
-- Name: sample_quality_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sample_quality_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sample_quality_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sample_quality_metrics_id_seq OWNED BY public.sample_quality_metrics.id;


--
-- Name: secure_deletion_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.secure_deletion_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name character varying(50) NOT NULL,
    record_id uuid NOT NULL,
    deletion_method character varying(20) NOT NULL,
    deletion_reason text,
    deleted_by uuid,
    deletion_timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    verification_hash character varying(255),
    compliance_verified boolean DEFAULT false
);


--
-- Name: str_loci_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.str_loci_config (
    id integer NOT NULL,
    locus_name character varying(20) NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true,
    description text
);


--
-- Name: str_loci_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.str_loci_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: str_loci_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.str_loci_config_id_seq OWNED BY public.str_loci_config.id;


--
-- Name: system_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_parameters (
    id integer NOT NULL,
    parameter_name character varying(50) NOT NULL,
    parameter_value numeric(10,8) NOT NULL,
    parameter_type character varying(20) NOT NULL,
    description text,
    valid_range_min numeric(10,8),
    valid_range_max numeric(10,8),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by uuid,
    CONSTRAINT system_parameters_parameter_type_check CHECK (((parameter_type)::text = ANY (ARRAY[('probability'::character varying)::text, ('threshold'::character varying)::text, ('coefficient'::character varying)::text])))
);


--
-- Name: system_parameters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_parameters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_parameters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_parameters_id_seq OWNED BY public.system_parameters.id;


--
-- Name: task_assignments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.task_assignments AS
 SELECT t.id,
    t.department_id,
    t.created_by,
    t.assigned_to_user,
    t.assigned_to_group,
    t.title,
    t.description,
    t.target_sample,
    t.data_source,
    t.data_source_id,
    t.status,
    t.priority,
    t.deadline,
    t.created_at,
    t.updated_at,
    t.started_at,
    t.completed_at,
    t.approved_at,
    t.approved_by,
    t.is_active,
    d.name AS department_name,
    o.name AS organization_name,
    creator.username AS created_by_username,
    assignee.username AS assigned_user_username,
    eg.name AS assigned_group_name,
    approver.username AS approved_by_username
   FROM ((((((public.tasks t
     JOIN public.departments d ON ((t.department_id = d.id)))
     JOIN public.organizations o ON ((d.organization_id = o.id)))
     JOIN public.users creator ON ((t.created_by = creator.id)))
     LEFT JOIN public.users assignee ON ((t.assigned_to_user = assignee.id)))
     LEFT JOIN public.expert_groups eg ON ((t.assigned_to_group = eg.id)))
     LEFT JOIN public.users approver ON ((t.approved_by = approver.id)))
  WHERE ((t.is_active = true) AND (d.is_active = true) AND (o.is_active = true));


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    comment text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    comment_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone
);


--
-- Name: task_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT task_notifications_type_check CHECK (((type)::text = ANY (ARRAY[('new_task'::character varying)::text, ('status_changed'::character varying)::text, ('task_cancelled'::character varying)::text, ('task_approved'::character varying)::text])))
);


--
-- Name: TABLE task_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_notifications IS 'Уведомления о задачах для пользователей';


--
-- Name: COLUMN task_notifications.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_notifications.type IS 'Тип уведомления: new_task, status_changed, task_cancelled, task_approved';


--
-- Name: COLUMN task_notifications.message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_notifications.message IS 'Текст уведомления на русском языке';


--
-- Name: COLUMN task_notifications.is_read; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_notifications.is_read IS 'Прочитано ли уведомление';


--
-- Name: task_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    result_data jsonb NOT NULL,
    analysis_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    result_data_encrypted text,
    analysis_metadata_encrypted text,
    encryption_version integer DEFAULT 1,
    encrypted_at timestamp without time zone
);


--
-- Name: unmigrated_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unmigrated_users (
    count bigint
);


--
-- Name: user_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_count (
    count bigint
);


--
-- Name: user_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    department_id uuid NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text,
    is_active boolean DEFAULT true
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: allele_frequencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allele_frequencies ALTER COLUMN id SET DEFAULT nextval('public.allele_frequencies_id_seq'::regclass);


--
-- Name: bayesian_analysis_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bayesian_analysis_results ALTER COLUMN id SET DEFAULT nextval('public.bayesian_analysis_results_id_seq'::regclass);


--
-- Name: encryption_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encryption_config ALTER COLUMN id SET DEFAULT nextval('public.encryption_config_id_seq'::regclass);


--
-- Name: population_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.population_data ALTER COLUMN id SET DEFAULT nextval('public.population_data_id_seq'::regclass);


--
-- Name: sample_quality_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_quality_metrics ALTER COLUMN id SET DEFAULT nextval('public.sample_quality_metrics_id_seq'::regclass);


--
-- Name: str_loci_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.str_loci_config ALTER COLUMN id SET DEFAULT nextval('public.str_loci_config_id_seq'::regclass);


--
-- Name: system_parameters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_parameters ALTER COLUMN id SET DEFAULT nextval('public.system_parameters_id_seq'::regclass);


--
-- Name: allele_frequencies allele_frequencies_locus_allele_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allele_frequencies
    ADD CONSTRAINT allele_frequencies_locus_allele_key UNIQUE (locus, allele);


--
-- Name: allele_frequencies allele_frequencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allele_frequencies
    ADD CONSTRAINT allele_frequencies_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bayesian_analysis_results bayesian_analysis_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bayesian_analysis_results
    ADD CONSTRAINT bayesian_analysis_results_pkey PRIMARY KEY (id);


--
-- Name: comment_edit_history comment_edit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_edit_history
    ADD CONSTRAINT comment_edit_history_pkey PRIMARY KEY (id);


--
-- Name: compliance_events compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_pkey PRIMARY KEY (id);


--
-- Name: contamination_analysis contamination_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contamination_analysis
    ADD CONSTRAINT contamination_analysis_pkey PRIMARY KEY (id);


--
-- Name: contamination_analysis contamination_analysis_sample_profile_id_staff_profile_id_a_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contamination_analysis
    ADD CONSTRAINT contamination_analysis_sample_profile_id_staff_profile_id_a_key UNIQUE (sample_profile_id, staff_profile_id, analysis_date);


--
-- Name: data_access_log data_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_access_log
    ADD CONSTRAINT data_access_log_pkey PRIMARY KEY (id);


--
-- Name: data_retention_policies data_retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policies
    ADD CONSTRAINT data_retention_policies_pkey PRIMARY KEY (id);


--
-- Name: data_retention_policies data_retention_policies_table_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policies
    ADD CONSTRAINT data_retention_policies_table_name_key UNIQUE (table_name);


--
-- Name: departments departments_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dna_profiles dna_profiles_new_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_new_pkey1 PRIMARY KEY (id);


--
-- Name: duplicate_group_comments duplicate_group_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_group_comments
    ADD CONSTRAINT duplicate_group_comments_pkey PRIMARY KEY (id);


--
-- Name: duplicate_group_comments duplicate_group_comments_task_id_group_identifier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_group_comments
    ADD CONSTRAINT duplicate_group_comments_task_id_group_identifier_key UNIQUE (task_id, group_identifier);


--
-- Name: encryption_audit_log encryption_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encryption_audit_log
    ADD CONSTRAINT encryption_audit_log_pkey PRIMARY KEY (id);


--
-- Name: encryption_config encryption_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encryption_config
    ADD CONSTRAINT encryption_config_pkey PRIMARY KEY (id);


--
-- Name: encryption_config encryption_config_table_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encryption_config
    ADD CONSTRAINT encryption_config_table_name_key UNIQUE (table_name);


--
-- Name: expert_group_members expert_group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_group_members
    ADD CONSTRAINT expert_group_members_group_id_user_id_key UNIQUE (group_id, user_id);


--
-- Name: expert_group_members expert_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_group_members
    ADD CONSTRAINT expert_group_members_pkey PRIMARY KEY (id);


--
-- Name: expert_groups expert_groups_department_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_groups
    ADD CONSTRAINT expert_groups_department_id_name_key UNIQUE (department_id, name);


--
-- Name: expert_groups expert_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_groups
    ADD CONSTRAINT expert_groups_pkey PRIMARY KEY (id);


--
-- Name: file_uploads file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);


--
-- Name: master_array_profiles master_array_profiles_master_array_id_year_internal_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_array_profiles
    ADD CONSTRAINT master_array_profiles_master_array_id_year_internal_number_key UNIQUE (master_array_id, year, internal_number);


--
-- Name: master_array_profiles master_array_profiles_new_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_array_profiles
    ADD CONSTRAINT master_array_profiles_new_pkey PRIMARY KEY (id);


--
-- Name: master_arrays master_arrays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_arrays
    ADD CONSTRAINT master_arrays_pkey PRIMARY KEY (id);


--
-- Name: match_results match_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_pkey PRIMARY KEY (id);


--
-- Name: match_results match_results_profile_id_1_profile_id_2_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_profile_id_1_profile_id_2_key UNIQUE (profile_id_1, profile_id_2);


--
-- Name: operation_history operation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_history
    ADD CONSTRAINT operation_history_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: population_data population_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.population_data
    ADD CONSTRAINT population_data_pkey PRIMARY KEY (id);


--
-- Name: population_data population_data_population_id_locus_name_allele_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.population_data
    ADD CONSTRAINT population_data_population_id_locus_name_allele_key UNIQUE (population_id, locus_name, allele);


--
-- Name: profile_contamination_log profile_contamination_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_pkey PRIMARY KEY (id);


--
-- Name: sample_quality_metrics sample_quality_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_quality_metrics
    ADD CONSTRAINT sample_quality_metrics_pkey PRIMARY KEY (id);


--
-- Name: secure_deletion_log secure_deletion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secure_deletion_log
    ADD CONSTRAINT secure_deletion_log_pkey PRIMARY KEY (id);


--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (id);


--
-- Name: staff_profiles staff_profiles_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_staff_id_key UNIQUE (staff_id);


--
-- Name: str_loci_config str_loci_config_locus_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.str_loci_config
    ADD CONSTRAINT str_loci_config_locus_name_key UNIQUE (locus_name);


--
-- Name: str_loci_config str_loci_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.str_loci_config
    ADD CONSTRAINT str_loci_config_pkey PRIMARY KEY (id);


--
-- Name: system_parameters system_parameters_parameter_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_parameters
    ADD CONSTRAINT system_parameters_parameter_name_key UNIQUE (parameter_name);


--
-- Name: system_parameters system_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_parameters
    ADD CONSTRAINT system_parameters_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_notifications task_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT task_notifications_pkey PRIMARY KEY (id);


--
-- Name: task_results task_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: profile_contamination_log unique_search_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT unique_search_result UNIQUE (reference_profile_id, matched_profile_id, search_date);


--
-- Name: user_departments user_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departments
    ADD CONSTRAINT user_departments_pkey PRIMARY KEY (id);


--
-- Name: user_departments user_departments_user_id_department_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departments
    ADD CONSTRAINT user_departments_user_id_department_id_key UNIQUE (user_id, department_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_allele_frequencies_allele; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allele_frequencies_allele ON public.allele_frequencies USING btree (allele);


--
-- Name: idx_allele_frequencies_frequency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allele_frequencies_frequency ON public.allele_frequencies USING btree (frequency);


--
-- Name: idx_allele_frequencies_locus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_allele_frequencies_locus ON public.allele_frequencies USING btree (locus);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);


--
-- Name: idx_audit_logs_compliance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_compliance ON public.audit_logs USING btree (compliance_level);


--
-- Name: idx_audit_logs_table_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_name ON public.audit_logs USING btree (table_name);


--
-- Name: idx_audit_logs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp");


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_bayesian_results_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_created ON public.bayesian_analysis_results USING btree (created_at);


--
-- Name: idx_bayesian_results_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_data ON public.bayesian_analysis_results USING gin (result_data);


--
-- Name: idx_bayesian_results_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_expires ON public.bayesian_analysis_results USING btree (expires_at);


--
-- Name: idx_bayesian_results_parameters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_parameters ON public.bayesian_analysis_results USING gin (parameters_used);


--
-- Name: idx_bayesian_results_profile1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_profile1 ON public.bayesian_analysis_results USING btree (profile1_id);


--
-- Name: idx_bayesian_results_profile2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_profile2 ON public.bayesian_analysis_results USING btree (profile2_id);


--
-- Name: idx_bayesian_results_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bayesian_results_type ON public.bayesian_analysis_results USING btree (analysis_type);


--
-- Name: idx_comment_edit_history_comment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_edit_history_comment ON public.comment_edit_history USING btree (comment_id);


--
-- Name: idx_comment_edit_history_edited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_edit_history_edited_at ON public.comment_edit_history USING btree (edited_at);


--
-- Name: idx_compliance_events_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_resolved ON public.compliance_events USING btree (resolved);


--
-- Name: idx_compliance_events_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_severity ON public.compliance_events USING btree (severity);


--
-- Name: idx_compliance_events_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_timestamp ON public.compliance_events USING btree ("timestamp");


--
-- Name: idx_compliance_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_type ON public.compliance_events USING btree (event_type);


--
-- Name: idx_contamination_analyzed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_analyzed_by ON public.contamination_analysis USING btree (analyzed_by);


--
-- Name: idx_contamination_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_date ON public.contamination_analysis USING btree (analysis_date);


--
-- Name: idx_contamination_log_contaminated_loci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_contaminated_loci ON public.profile_contamination_log USING gin (contaminated_loci);


--
-- Name: idx_contamination_log_date_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_date_type ON public.profile_contamination_log USING btree (search_date, match_type);


--
-- Name: idx_contamination_log_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_department ON public.profile_contamination_log USING btree (department_id);


--
-- Name: idx_contamination_log_match_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_match_type ON public.profile_contamination_log USING btree (match_type);


--
-- Name: idx_contamination_log_matched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_matched ON public.profile_contamination_log USING btree (matched_profile_id);


--
-- Name: idx_contamination_log_matched_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_matched_import ON public.profile_contamination_log USING btree (matched_import_number);


--
-- Name: idx_contamination_log_matched_loci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_matched_loci ON public.profile_contamination_log USING gin (matched_loci);


--
-- Name: idx_contamination_log_matched_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_matched_year ON public.profile_contamination_log USING btree (matched_year);


--
-- Name: idx_contamination_log_ref_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_ref_import ON public.profile_contamination_log USING btree (reference_import_number);


--
-- Name: idx_contamination_log_ref_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_ref_year ON public.profile_contamination_log USING btree (reference_year);


--
-- Name: idx_contamination_log_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_reference ON public.profile_contamination_log USING btree (reference_profile_id);


--
-- Name: idx_contamination_log_search_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_search_date ON public.profile_contamination_log USING btree (search_date);


--
-- Name: idx_contamination_log_searched_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_searched_by ON public.profile_contamination_log USING btree (searched_by);


--
-- Name: idx_contamination_log_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_log_task ON public.profile_contamination_log USING btree (task_id);


--
-- Name: idx_contamination_matches; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_matches ON public.contamination_analysis USING gin (locus_matches);


--
-- Name: idx_contamination_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_method ON public.contamination_analysis USING btree (analysis_method);


--
-- Name: idx_contamination_percentage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_percentage ON public.contamination_analysis USING btree (contamination_percentage);


--
-- Name: idx_contamination_sample_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contamination_sample_staff ON public.contamination_analysis USING btree (sample_profile_id, staff_profile_id);


--
-- Name: idx_data_access_log_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_access_log_classification ON public.data_access_log USING btree (data_classification);


--
-- Name: idx_data_access_log_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_access_log_resource ON public.data_access_log USING btree (resource_type, resource_id);


--
-- Name: idx_data_access_log_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_access_log_timestamp ON public.data_access_log USING btree ("timestamp");


--
-- Name: idx_data_access_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_access_log_user_id ON public.data_access_log USING btree (user_id);


--
-- Name: idx_departments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_active ON public.departments USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_departments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_organization ON public.departments USING btree (organization_id);


--
-- Name: idx_dna_profiles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_active ON public.dna_profiles USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_dna_profiles_comment_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_comment_updated_by ON public.dna_profiles USING btree (comment_updated_by);


--
-- Name: idx_dna_profiles_deactivated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_deactivated_by ON public.dna_profiles USING btree (deactivated_by);


--
-- Name: idx_dna_profiles_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_encrypted_at ON public.dna_profiles USING btree (encrypted_at);


--
-- Name: idx_dna_profiles_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_encryption_version ON public.dna_profiles USING btree (encryption_version);


--
-- Name: idx_dna_profiles_import_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_import_number ON public.dna_profiles USING btree (import_number) WHERE (is_active = true);


--
-- Name: idx_dna_profiles_internal_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_internal_number ON public.dna_profiles USING btree (internal_number);


--
-- Name: idx_dna_profiles_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_is_active ON public.dna_profiles USING btree (is_active);


--
-- Name: idx_dna_profiles_master_array; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_master_array ON public.dna_profiles USING btree (master_array_id);


--
-- Name: idx_dna_profiles_profile_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_profile_type ON public.dna_profiles USING btree (profile_type);


--
-- Name: idx_dna_profiles_sample_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_sample_name ON public.dna_profiles USING btree (sample_name);


--
-- Name: idx_dna_profiles_str_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_str_data ON public.dna_profiles USING gin (str_data);


--
-- Name: idx_dna_profiles_str_data_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_str_data_gin ON public.dna_profiles USING gin (str_data) WHERE (str_data IS NOT NULL);


--
-- Name: idx_dna_profiles_task_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_task_active ON public.dna_profiles USING btree (task_id, is_active) WHERE ((task_id IS NOT NULL) AND (is_active = true));


--
-- Name: idx_dna_profiles_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_task_id ON public.dna_profiles USING btree (task_id) WHERE (task_id IS NOT NULL);


--
-- Name: idx_dna_profiles_upload_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_upload_date ON public.dna_profiles USING btree (upload_date);


--
-- Name: idx_dna_profiles_user_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_user_dept ON public.dna_profiles USING btree (user_id) WHERE (is_active = true);


--
-- Name: idx_dna_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_user_id ON public.dna_profiles USING btree (user_id);


--
-- Name: idx_dna_profiles_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dna_profiles_year ON public.dna_profiles USING btree (year) WHERE (year IS NOT NULL);


--
-- Name: idx_dna_profiles_year_internal_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dna_profiles_year_internal_user ON public.dna_profiles USING btree (year, internal_number, user_id) WHERE ((is_active = true) AND (internal_number IS NOT NULL));


--
-- Name: idx_duplicate_group_comments_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_duplicate_group_comments_created_by ON public.duplicate_group_comments USING btree (created_by);


--
-- Name: idx_duplicate_group_comments_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_duplicate_group_comments_task_id ON public.duplicate_group_comments USING btree (task_id);


--
-- Name: idx_encryption_audit_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encryption_audit_operation ON public.encryption_audit_log USING btree (operation);


--
-- Name: idx_encryption_audit_performed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encryption_audit_performed_at ON public.encryption_audit_log USING btree (performed_at);


--
-- Name: idx_encryption_audit_success; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encryption_audit_success ON public.encryption_audit_log USING btree (success);


--
-- Name: idx_encryption_audit_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encryption_audit_table_record ON public.encryption_audit_log USING btree (table_name, record_id);


--
-- Name: idx_expert_group_members_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_group_members_active ON public.expert_group_members USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_expert_group_members_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_group_members_group ON public.expert_group_members USING btree (group_id);


--
-- Name: idx_expert_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_group_members_user ON public.expert_group_members USING btree (user_id);


--
-- Name: idx_expert_groups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_groups_active ON public.expert_groups USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_expert_groups_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_groups_created_by ON public.expert_groups USING btree (created_by);


--
-- Name: idx_expert_groups_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expert_groups_department ON public.expert_groups USING btree (department_id);


--
-- Name: idx_file_uploads_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_date ON public.file_uploads USING btree (upload_date);


--
-- Name: idx_file_uploads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_status ON public.file_uploads USING btree (processing_status);


--
-- Name: idx_file_uploads_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_user_id ON public.file_uploads USING btree (user_id);


--
-- Name: idx_master_array_profiles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_active ON public.master_array_profiles USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_master_array_profiles_array; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_array ON public.master_array_profiles USING btree (master_array_id);


--
-- Name: idx_master_array_profiles_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_created_by ON public.master_array_profiles USING btree (created_by);


--
-- Name: idx_master_array_profiles_d1s1656; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_d1s1656 ON public.master_array_profiles USING gin (((str_data -> 'D1S1656'::text)));


--
-- Name: idx_master_array_profiles_d21s11; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_d21s11 ON public.master_array_profiles USING gin (((str_data -> 'D21S11'::text)));


--
-- Name: INDEX idx_master_array_profiles_d21s11; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_master_array_profiles_d21s11 IS 'GIN индекс для пре-фильтрации по локусу D21S11 (группа "стабильные")';


--
-- Name: idx_master_array_profiles_d3s1358; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_d3s1358 ON public.master_array_profiles USING gin (((str_data -> 'D3S1358'::text)));


--
-- Name: idx_master_array_profiles_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_encrypted_at ON public.master_array_profiles USING btree (encrypted_at);


--
-- Name: idx_master_array_profiles_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_encryption_version ON public.master_array_profiles USING btree (encryption_version);


--
-- Name: idx_master_array_profiles_import_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_import_number ON public.master_array_profiles USING btree (import_number) WHERE (import_number IS NOT NULL);


--
-- Name: idx_master_array_profiles_internal_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_internal_number ON public.master_array_profiles USING btree (internal_number) WHERE (internal_number IS NOT NULL);


--
-- Name: idx_master_array_profiles_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_sample ON public.master_array_profiles USING btree (sample_name);


--
-- Name: idx_master_array_profiles_se33; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_se33 ON public.master_array_profiles USING gin (((str_data -> 'SE33'::text)));


--
-- Name: idx_master_array_profiles_str_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_str_data ON public.master_array_profiles USING gin (str_data);


--
-- Name: idx_master_array_profiles_str_data_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_str_data_gin ON public.master_array_profiles USING gin (str_data);


--
-- Name: idx_master_array_profiles_th01; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_th01 ON public.master_array_profiles USING gin (((str_data -> 'TH01'::text)));


--
-- Name: idx_master_array_profiles_vwa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_vwa ON public.master_array_profiles USING gin (((str_data -> 'vWA'::text)));


--
-- Name: INDEX idx_master_array_profiles_vwa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_master_array_profiles_vwa IS 'GIN индекс для пре-фильтрации по локусу vWA (группа "мощные")';


--
-- Name: idx_master_array_profiles_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_array_profiles_year ON public.master_array_profiles USING btree (year) WHERE (year IS NOT NULL);


--
-- Name: idx_master_arrays_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_arrays_active ON public.master_arrays USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_master_arrays_comment_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_arrays_comment_updated_by ON public.master_arrays USING btree (comment_updated_by);


--
-- Name: idx_master_arrays_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_arrays_department ON public.master_arrays USING btree (department_id);


--
-- Name: idx_match_results_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_date ON public.match_results USING btree (analysis_date);


--
-- Name: idx_match_results_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_encrypted_at ON public.match_results USING btree (encrypted_at);


--
-- Name: idx_match_results_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_encryption_version ON public.match_results USING btree (encryption_version);


--
-- Name: idx_match_results_locus_matches; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_locus_matches ON public.match_results USING gin (locus_matches);


--
-- Name: idx_match_results_percentage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_percentage ON public.match_results USING btree (overall_match_percentage);


--
-- Name: idx_match_results_profiles; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_results_profiles ON public.match_results USING btree (profile_id_1, profile_id_2);


--
-- Name: idx_operation_history_affected_resources; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_affected_resources ON public.operation_history USING gin (affected_resources);


--
-- Name: idx_operation_history_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_department ON public.operation_history USING btree (department_id);


--
-- Name: idx_operation_history_dept_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_dept_timestamp ON public.operation_history USING btree (department_id, "timestamp");


--
-- Name: idx_operation_history_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_timestamp ON public.operation_history USING btree ("timestamp");


--
-- Name: idx_operation_history_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_type ON public.operation_history USING btree (operation_type);


--
-- Name: idx_operation_history_user_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_history_user_timestamp ON public.operation_history USING btree (user_id, "timestamp");


--
-- Name: idx_population_data_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_population_data_composite ON public.population_data USING btree (population_id, locus_name, allele);


--
-- Name: idx_population_data_locus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_population_data_locus ON public.population_data USING btree (locus_name);


--
-- Name: idx_population_data_population_locus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_population_data_population_locus ON public.population_data USING btree (population_id, locus_name);


--
-- Name: idx_population_data_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_population_data_updated ON public.population_data USING btree (updated_at);


--
-- Name: idx_population_stats_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_population_stats_lookup ON public.population_stats USING btree (population_id, locus_name);


--
-- Name: idx_quality_metrics_date_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_metrics_date_range ON public.sample_quality_metrics USING btree (analysis_timestamp, contamination_probability, degradation_index);


--
-- Name: idx_quality_metrics_quality_filter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_metrics_quality_filter ON public.sample_quality_metrics USING btree (contamination_probability, degradation_index, quality_score) WHERE ((contamination_probability IS NOT NULL) OR (degradation_index IS NOT NULL));


--
-- Name: idx_sample_quality_metadata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_quality_metadata ON public.sample_quality_metrics USING gin (analysis_metadata);


--
-- Name: idx_sample_quality_metrics_population; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_quality_metrics_population ON public.sample_quality_metrics USING btree (population_used);


--
-- Name: idx_sample_quality_metrics_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_quality_metrics_profile ON public.sample_quality_metrics USING btree (profile_id);


--
-- Name: idx_sample_quality_metrics_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_quality_metrics_timestamp ON public.sample_quality_metrics USING btree (analysis_timestamp);


--
-- Name: idx_secure_deletion_log_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_secure_deletion_log_table ON public.secure_deletion_log USING btree (table_name);


--
-- Name: idx_secure_deletion_log_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_secure_deletion_log_timestamp ON public.secure_deletion_log USING btree (deletion_timestamp);


--
-- Name: idx_staff_profiles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_active ON public.staff_profiles USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_staff_profiles_date_added; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_date_added ON public.staff_profiles USING btree (date_added);


--
-- Name: idx_staff_profiles_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_department ON public.staff_profiles USING btree (department);


--
-- Name: idx_staff_profiles_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_name ON public.staff_profiles USING btree (full_name);


--
-- Name: idx_staff_profiles_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_staff_id ON public.staff_profiles USING btree (staff_id);


--
-- Name: idx_staff_profiles_str_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_str_data ON public.staff_profiles USING gin (str_data);


--
-- Name: idx_system_parameters_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_parameters_name ON public.system_parameters USING btree (parameter_name);


--
-- Name: idx_system_parameters_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_parameters_type ON public.system_parameters USING btree (parameter_type);


--
-- Name: idx_task_comments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_created_at ON public.task_comments USING btree (created_at);


--
-- Name: idx_task_comments_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_encrypted_at ON public.task_comments USING btree (encrypted_at);


--
-- Name: idx_task_comments_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_encryption_version ON public.task_comments USING btree (encryption_version);


--
-- Name: idx_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_task ON public.task_comments USING btree (task_id);


--
-- Name: idx_task_comments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_user ON public.task_comments USING btree (user_id);


--
-- Name: idx_task_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_created_at ON public.task_notifications USING btree (created_at DESC);


--
-- Name: idx_task_notifications_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_task ON public.task_notifications USING btree (task_id);


--
-- Name: idx_task_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_type ON public.task_notifications USING btree (type);


--
-- Name: idx_task_notifications_user_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_user_read ON public.task_notifications USING btree (user_id, is_read);


--
-- Name: idx_task_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_user_unread ON public.task_notifications USING btree (user_id) WHERE (is_read = false);


--
-- Name: idx_task_results_analysis_metadata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_analysis_metadata ON public.task_results USING gin (analysis_metadata);


--
-- Name: idx_task_results_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_created_at ON public.task_results USING btree (created_at);


--
-- Name: idx_task_results_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_encrypted_at ON public.task_results USING btree (encrypted_at);


--
-- Name: idx_task_results_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_encryption_version ON public.task_results USING btree (encryption_version);


--
-- Name: idx_task_results_result_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_result_data ON public.task_results USING gin (result_data);


--
-- Name: idx_task_results_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_task ON public.task_results USING btree (task_id);


--
-- Name: idx_task_results_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_results_user ON public.task_results USING btree (user_id);


--
-- Name: idx_tasks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_active ON public.tasks USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_tasks_assigned_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned_group ON public.tasks USING btree (assigned_to_group);


--
-- Name: idx_tasks_assigned_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned_user ON public.tasks USING btree (assigned_to_user);


--
-- Name: idx_tasks_cancelled_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_cancelled_at ON public.tasks USING btree (cancelled_at);


--
-- Name: idx_tasks_cancelled_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_cancelled_by ON public.tasks USING btree (cancelled_by);


--
-- Name: idx_tasks_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created_by ON public.tasks USING btree (created_by);


--
-- Name: idx_tasks_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_deadline ON public.tasks USING btree (deadline);


--
-- Name: idx_tasks_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_department ON public.tasks USING btree (department_id);


--
-- Name: idx_tasks_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_encrypted_at ON public.tasks USING btree (encrypted_at);


--
-- Name: idx_tasks_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_encryption_version ON public.tasks USING btree (encryption_version);


--
-- Name: idx_tasks_internal_number_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_internal_number_end ON public.tasks USING btree (internal_number_end);


--
-- Name: idx_tasks_internal_number_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_internal_number_start ON public.tasks USING btree (internal_number_start);


--
-- Name: idx_tasks_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_priority ON public.tasks USING btree (priority);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tasks_target_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_target_sample ON public.tasks USING gin (target_sample);


--
-- Name: idx_user_departments_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_departments_department ON public.user_departments USING btree (department_id);


--
-- Name: idx_user_departments_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_departments_primary ON public.user_departments USING btree (user_id) WHERE (is_primary = true);


--
-- Name: idx_user_departments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_departments_user ON public.user_departments USING btree (user_id);


--
-- Name: idx_user_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_active ON public.user_sessions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_user_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_expires ON public.user_sessions USING btree (expires_at);


--
-- Name: idx_user_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: idx_user_settings_settings; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_settings ON public.user_settings USING gin (settings);


--
-- Name: idx_user_settings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);


--
-- Name: idx_users_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_department ON public.users USING btree (department_id);


--
-- Name: idx_users_encrypted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_encrypted_at ON public.users USING btree (encrypted_at);


--
-- Name: idx_users_encryption_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_encryption_version ON public.users USING btree (encryption_version);


--
-- Name: idx_users_org_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_org_dept ON public.users USING btree (organization_id, department_id) WHERE (is_active = true);


--
-- Name: idx_users_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_organization ON public.users USING btree (organization_id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bayesian_analysis_results bayesian_analysis_results_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bayesian_analysis_results
    ADD CONSTRAINT bayesian_analysis_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bayesian_analysis_results bayesian_analysis_results_profile1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bayesian_analysis_results
    ADD CONSTRAINT bayesian_analysis_results_profile1_id_fkey FOREIGN KEY (profile1_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: bayesian_analysis_results bayesian_analysis_results_profile2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bayesian_analysis_results
    ADD CONSTRAINT bayesian_analysis_results_profile2_id_fkey FOREIGN KEY (profile2_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: comment_edit_history comment_edit_history_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_edit_history
    ADD CONSTRAINT comment_edit_history_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.task_comments(id) ON DELETE CASCADE;


--
-- Name: comment_edit_history comment_edit_history_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_edit_history
    ADD CONSTRAINT comment_edit_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id);


--
-- Name: compliance_events compliance_events_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_events compliance_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contamination_analysis contamination_analysis_analyzed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contamination_analysis
    ADD CONSTRAINT contamination_analysis_analyzed_by_fkey FOREIGN KEY (analyzed_by) REFERENCES public.users(id);


--
-- Name: contamination_analysis contamination_analysis_sample_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contamination_analysis
    ADD CONSTRAINT contamination_analysis_sample_profile_id_fkey FOREIGN KEY (sample_profile_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: contamination_analysis contamination_analysis_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contamination_analysis
    ADD CONSTRAINT contamination_analysis_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES public.staff_profiles(id) ON DELETE CASCADE;


--
-- Name: data_access_log data_access_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_access_log
    ADD CONSTRAINT data_access_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: departments departments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: dna_profiles dna_profiles_comment_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_comment_updated_by_fkey FOREIGN KEY (comment_updated_by) REFERENCES public.users(id);


--
-- Name: dna_profiles dna_profiles_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.users(id);


--
-- Name: dna_profiles dna_profiles_new_master_array_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_new_master_array_id_fkey FOREIGN KEY (master_array_id) REFERENCES public.master_arrays(id) ON DELETE SET NULL;


--
-- Name: dna_profiles dna_profiles_new_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_new_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: dna_profiles dna_profiles_new_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dna_profiles
    ADD CONSTRAINT dna_profiles_new_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: duplicate_group_comments duplicate_group_comments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_group_comments
    ADD CONSTRAINT duplicate_group_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: duplicate_group_comments duplicate_group_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_group_comments
    ADD CONSTRAINT duplicate_group_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: encryption_audit_log encryption_audit_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encryption_audit_log
    ADD CONSTRAINT encryption_audit_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: expert_group_members expert_group_members_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_group_members
    ADD CONSTRAINT expert_group_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: expert_group_members expert_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_group_members
    ADD CONSTRAINT expert_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expert_groups(id) ON DELETE CASCADE;


--
-- Name: expert_group_members expert_group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_group_members
    ADD CONSTRAINT expert_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: expert_groups expert_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_groups
    ADD CONSTRAINT expert_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: expert_groups expert_groups_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_groups
    ADD CONSTRAINT expert_groups_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: file_uploads file_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: departments fk_departments_master_array; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT fk_departments_master_array FOREIGN KEY (master_array_id) REFERENCES public.master_arrays(id) ON DELETE SET NULL;


--
-- Name: users fk_users_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: master_array_profiles master_array_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_array_profiles
    ADD CONSTRAINT master_array_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: master_array_profiles master_array_profiles_master_array_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_array_profiles
    ADD CONSTRAINT master_array_profiles_master_array_id_fkey FOREIGN KEY (master_array_id) REFERENCES public.master_arrays(id) ON DELETE CASCADE;


--
-- Name: master_arrays master_arrays_comment_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_arrays
    ADD CONSTRAINT master_arrays_comment_updated_by_fkey FOREIGN KEY (comment_updated_by) REFERENCES public.users(id);


--
-- Name: master_arrays master_arrays_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_arrays
    ADD CONSTRAINT master_arrays_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: match_results match_results_analyzed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_analyzed_by_fkey FOREIGN KEY (analyzed_by) REFERENCES public.users(id);


--
-- Name: match_results match_results_profile_id_1_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_profile_id_1_fkey FOREIGN KEY (profile_id_1) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: match_results match_results_profile_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_profile_id_2_fkey FOREIGN KEY (profile_id_2) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: operation_history operation_history_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_history
    ADD CONSTRAINT operation_history_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: operation_history operation_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_history
    ADD CONSTRAINT operation_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: profile_contamination_log profile_contamination_log_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: profile_contamination_log profile_contamination_log_matched_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_matched_profile_id_fkey FOREIGN KEY (matched_profile_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: profile_contamination_log profile_contamination_log_reference_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_reference_profile_id_fkey FOREIGN KEY (reference_profile_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: profile_contamination_log profile_contamination_log_searched_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_searched_by_fkey FOREIGN KEY (searched_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: profile_contamination_log profile_contamination_log_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_contamination_log
    ADD CONSTRAINT profile_contamination_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: sample_quality_metrics sample_quality_metrics_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_quality_metrics
    ADD CONSTRAINT sample_quality_metrics_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.dna_profiles(id) ON DELETE CASCADE;


--
-- Name: secure_deletion_log secure_deletion_log_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secure_deletion_log
    ADD CONSTRAINT secure_deletion_log_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_profiles staff_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: system_parameters system_parameters_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_parameters
    ADD CONSTRAINT system_parameters_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: task_comments task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: task_notifications task_notifications_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT task_notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_notifications task_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT task_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_results task_results_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_results task_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tasks tasks_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_assigned_to_group_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_group_fkey FOREIGN KEY (assigned_to_group) REFERENCES public.expert_groups(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_assigned_to_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_user_fkey FOREIGN KEY (assigned_to_user) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tasks tasks_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: user_departments user_departments_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departments
    ADD CONSTRAINT user_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: user_departments user_departments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departments
    ADD CONSTRAINT user_departments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict UdtYm5R8ZnYfLTJwFpuPcLbQtvzf486KAwzkhpxYqJsPAgLjCImRmfHZP7ittxi


-- Принадлежность профиля активному отделению при загрузке.
ALTER TABLE public.dna_profiles ADD CONSTRAINT dna_profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);
ALTER TABLE public.dna_profiles ADD CONSTRAINT dna_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
CREATE UNIQUE INDEX idx_dna_profiles_genetic_object ON public.dna_profiles (organization_id, department_id, user_id, lower(btrim(internal_number))) WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user';
CREATE INDEX idx_dna_profiles_department ON public.dna_profiles (department_id) WHERE is_active = true;

CREATE UNIQUE INDEX idx_master_array_genetic_object ON public.master_array_profiles (master_array_id, lower(btrim(internal_number))) WHERE is_active = true AND metadata->>'importFormat' = 'genetic';

-- Необязательные генетические панели (029).
SET search_path = public;
CREATE TABLE IF NOT EXISTS genotype_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  name varchar(150) NOT NULL CHECK (btrim(name) <> ''),
  description text,
  loci_order jsonb NOT NULL CHECK (jsonb_typeof(loci_order) = 'array' AND jsonb_array_length(loci_order) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, organization_id, department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_genotype_panels_name
  ON genotype_panels (organization_id, department_id, lower(btrim(name)));
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS panel_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dna_profiles_panel_scope_fkey') THEN
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_panel_scope_fkey
      FOREIGN KEY (panel_id, organization_id, department_id)
      REFERENCES genotype_panels (id, organization_id, department_id);
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_panel_format_check
      CHECK (panel_id IS NULL OR import_format = 'genetic');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dna_profiles_panel ON dna_profiles(panel_id) WHERE panel_id IS NOT NULL;

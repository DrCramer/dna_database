-- ============================================================================
-- DNA Analysis Web Application - Complete Database Initialization
-- Production Deployment Version
-- ============================================================================
-- This script initializes the PostgreSQL database with:
-- 1. Base schema (tables, indexes, views)
-- 2. Multi-user organizational structure
-- 3. Master array support
-- 4. Initial organization "СМЭ" with departments
-- 5. Default admin user
-- ============================================================================

-- ============================================================================
-- PART 1: EXTENSIONS AND BASIC SETUP
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PART 2: BASE TABLES (from init.sql)
-- ============================================================================

-- Users table for authentication and authorization
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin', 'analyst', 'viewer', 'system_administrator', 'department_head', 'user_analyst')),
    can_upload_with_task BOOLEAN NOT NULL DEFAULT true,
    can_upload_without_task BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- DNA profiles storage with 39 STR loci data
CREATE TABLE dna_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    sample_name VARCHAR(100) NOT NULL,
    str_data JSONB NOT NULL,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    file_source TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true
);

-- Match results cache for performance optimization
CREATE TABLE match_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id_1 UUID REFERENCES dna_profiles(id) ON DELETE CASCADE,
    profile_id_2 UUID REFERENCES dna_profiles(id) ON DELETE CASCADE,
    overall_match_percentage DECIMAL(5,2) NOT NULL CHECK (overall_match_percentage >= 0 AND overall_match_percentage <= 100),
    locus_matches JSONB NOT NULL,
    analysis_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    analyzed_by UUID REFERENCES users(id),
    UNIQUE(profile_id_1, profile_id_2),
    CHECK (profile_id_1 != profile_id_2)
);

-- Operation history for audit trail and compliance
CREATE TABLE operation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL,
    operation_details JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT true
);

-- User sessions for JWT token management
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT true
);

-- File uploads tracking
CREATE TABLE file_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_status VARCHAR(20) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    profiles_extracted INTEGER DEFAULT 0,
    error_message TEXT
);

-- STR loci configuration
CREATE TABLE str_loci_config (
    id SERIAL PRIMARY KEY,
    locus_name VARCHAR(20) NOT NULL UNIQUE,
    display_order INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- ============================================================================
-- PART 3: MULTI-USER ORGANIZATIONAL STRUCTURE
-- ============================================================================

-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Departments table
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    master_array_id UUID,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(organization_id, name)
);

-- Master arrays table
CREATE TABLE master_arrays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Add foreign key from departments to master_arrays
ALTER TABLE departments 
ADD CONSTRAINT fk_departments_master_array 
FOREIGN KEY (master_array_id) REFERENCES master_arrays(id) ON DELETE SET NULL;

-- Master array profiles
CREATE TABLE master_array_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_array_id UUID NOT NULL REFERENCES master_arrays(id) ON DELETE CASCADE,
    year INTEGER,
    sample_name VARCHAR(255) NOT NULL,
    internal_number VARCHAR(255),
    import_number VARCHAR(255),
    str_data JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(master_array_id, sample_name)
);

-- Expert groups table
CREATE TABLE expert_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(department_id, name)
);

-- Expert group members
CREATE TABLE expert_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES expert_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(group_id, user_id)
);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_to_user UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to_group UUID REFERENCES expert_groups(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target_sample JSONB NOT NULL,
    data_source VARCHAR(50) NOT NULL CHECK (data_source IN ('master_array', 'user_array', 'new_array')),
    data_source_id UUID,
    status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'approved')),
    priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    CHECK (assigned_to_user IS NOT NULL OR assigned_to_group IS NOT NULL)
);

-- Task comments
CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Task results
CREATE TABLE task_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    result_data JSONB NOT NULL,
    analysis_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- System parameters for Bayesian analysis
CREATE TABLE system_parameters (
    id SERIAL PRIMARY KEY,
    parameter_key VARCHAR(100),
    parameter_name VARCHAR(100) NOT NULL UNIQUE,
    parameter_value TEXT NOT NULL,
    parameter_type VARCHAR(50),
    description TEXT,
    valid_range_min DECIMAL(10,4),
    valid_range_max DECIMAL(10,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    notification_type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

-- Bayesian analysis results
CREATE TABLE bayesian_analysis_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id_1 UUID REFERENCES dna_profiles(id) ON DELETE CASCADE,
    profile_id_2 UUID REFERENCES dna_profiles(id) ON DELETE CASCADE,
    lr_value DECIMAL(20,2),
    log_lr DECIMAL(10,2),
    analysis_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    analyzed_by UUID REFERENCES users(id),
    analysis_parameters JSONB,
    UNIQUE(profile_id_1, profile_id_2)
);

-- ============================================================================
-- PART 4: EXTEND EXISTING TABLES WITH ORGANIZATIONAL FIELDS
-- ============================================================================

-- Add organizational fields to users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- User access to multiple departments
CREATE TABLE IF NOT EXISTS user_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, department_id)
);

-- Add organizational fields to dna_profiles
ALTER TABLE dna_profiles 
ADD COLUMN IF NOT EXISTS master_array_id UUID REFERENCES master_arrays(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS profile_type VARCHAR(20) DEFAULT 'user' CHECK (profile_type IN ('user', 'master')),
ADD COLUMN IF NOT EXISTS internal_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS import_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS year INTEGER,
ADD COLUMN IF NOT EXISTS import_format VARCHAR(20) NOT NULL DEFAULT 'emergency',
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id),
ADD COLUMN IF NOT EXISTS privoz VARCHAR(255);

-- Проверки нового формата для исторического варианта инициализации.
ALTER TABLE dna_profiles
ADD CONSTRAINT dna_profiles_import_format_check CHECK (import_format IN ('emergency', 'genetic')),
ADD CONSTRAINT dna_profiles_import_year_check CHECK (year IS NOT NULL OR import_format = 'genetic'),
ADD CONSTRAINT dna_profiles_genetic_scope_check CHECK (import_format <> 'genetic' OR (department_id IS NOT NULL AND organization_id IS NOT NULL));
CREATE UNIQUE INDEX idx_dna_profiles_genetic_object ON dna_profiles (organization_id, department_id, user_id, lower(btrim(internal_number))) WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user';

-- Add organizational context to operation_history
ALTER TABLE operation_history 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS affected_resources JSONB DEFAULT '{}';

-- ============================================================================
-- PART 5: INDEXES FOR PERFORMANCE
-- ============================================================================

-- Base table indexes
CREATE INDEX idx_dna_profiles_user_id ON dna_profiles(user_id);
CREATE INDEX idx_dna_profiles_sample_name ON dna_profiles(sample_name);
CREATE INDEX idx_dna_profiles_internal_number ON dna_profiles(internal_number);
CREATE INDEX idx_dna_profiles_import_number ON dna_profiles(import_number);
CREATE INDEX idx_dna_profiles_upload_date ON dna_profiles(upload_date);
CREATE INDEX idx_dna_profiles_active ON dna_profiles(is_active) WHERE is_active = true;
CREATE INDEX idx_dna_profiles_str_data ON dna_profiles USING GIN (str_data);
CREATE INDEX idx_dna_profiles_master_array ON dna_profiles(master_array_id);
CREATE INDEX idx_dna_profiles_profile_type ON dna_profiles(profile_type);

CREATE INDEX idx_match_results_profiles ON match_results(profile_id_1, profile_id_2);
CREATE INDEX idx_match_results_percentage ON match_results(overall_match_percentage);
CREATE INDEX idx_match_results_date ON match_results(analysis_date);
CREATE INDEX idx_match_results_locus_matches ON match_results USING GIN (locus_matches);

CREATE INDEX idx_operation_history_user_timestamp ON operation_history(user_id, timestamp);
CREATE INDEX idx_operation_history_type ON operation_history(operation_type);
CREATE INDEX idx_operation_history_timestamp ON operation_history(timestamp);
CREATE INDEX idx_operation_history_department ON operation_history(department_id);
CREATE INDEX idx_operation_history_dept_timestamp ON operation_history(department_id, timestamp);
CREATE INDEX idx_operation_history_affected_resources ON operation_history USING GIN(affected_resources);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true;

CREATE INDEX idx_file_uploads_user_id ON file_uploads(user_id);
CREATE INDEX idx_file_uploads_status ON file_uploads(processing_status);
CREATE INDEX idx_file_uploads_date ON file_uploads(upload_date);

-- Organizational structure indexes
CREATE INDEX idx_organizations_active ON organizations(is_active) WHERE is_active = true;
CREATE INDEX idx_departments_organization ON departments(organization_id);
CREATE INDEX idx_departments_active ON departments(is_active) WHERE is_active = true;
CREATE INDEX idx_master_arrays_department ON master_arrays(department_id);
CREATE INDEX idx_master_arrays_active ON master_arrays(is_active) WHERE is_active = true;

CREATE INDEX idx_master_array_profiles_array ON master_array_profiles(master_array_id);
CREATE INDEX idx_master_array_profiles_sample ON master_array_profiles(sample_name);
CREATE INDEX idx_master_array_profiles_internal_number ON master_array_profiles(internal_number) WHERE is_active = true;
CREATE INDEX idx_master_array_profiles_import_number ON master_array_profiles(import_number) WHERE is_active = true;
CREATE INDEX idx_master_array_profiles_created_by ON master_array_profiles(created_by);
CREATE INDEX idx_master_array_profiles_active ON master_array_profiles(is_active) WHERE is_active = true;
CREATE INDEX idx_master_array_profiles_str_data ON master_array_profiles USING GIN (str_data);

CREATE INDEX idx_expert_groups_department ON expert_groups(department_id);
CREATE INDEX idx_expert_groups_created_by ON expert_groups(created_by);
CREATE INDEX idx_expert_groups_active ON expert_groups(is_active) WHERE is_active = true;

CREATE INDEX idx_expert_group_members_group ON expert_group_members(group_id);
CREATE INDEX idx_expert_group_members_user ON expert_group_members(user_id);
CREATE INDEX idx_expert_group_members_active ON expert_group_members(is_active) WHERE is_active = true;

CREATE INDEX idx_tasks_department ON tasks(department_id);
CREATE INDEX idx_tasks_created_by ON tasks(created_by);
CREATE INDEX idx_tasks_assigned_user ON tasks(assigned_to_user);
CREATE INDEX idx_tasks_assigned_group ON tasks(assigned_to_group);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);
CREATE INDEX idx_tasks_active ON tasks(is_active) WHERE is_active = true;
CREATE INDEX idx_tasks_target_sample ON tasks USING GIN (target_sample);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);
CREATE INDEX idx_task_comments_user ON task_comments(user_id);
CREATE INDEX idx_task_comments_created_at ON task_comments(created_at);

CREATE INDEX idx_task_results_task ON task_results(task_id);
CREATE INDEX idx_task_results_user ON task_results(user_id);
CREATE INDEX idx_task_results_created_at ON task_results(created_at);
CREATE INDEX idx_task_results_result_data ON task_results USING GIN (result_data);
CREATE INDEX idx_task_results_analysis_metadata ON task_results USING GIN (analysis_metadata);

CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_org_dept ON users(organization_id, department_id) WHERE is_active = true;
CREATE INDEX idx_user_departments_user ON user_departments(user_id);
CREATE INDEX idx_user_departments_department ON user_departments(department_id);
CREATE UNIQUE INDEX idx_user_departments_primary ON user_departments(user_id) WHERE is_primary = true;

CREATE INDEX idx_system_parameters_name ON system_parameters(parameter_name);
CREATE INDEX idx_system_parameters_updated ON system_parameters(updated_at);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

CREATE INDEX idx_bayesian_results_profiles ON bayesian_analysis_results(profile_id_1, profile_id_2);
CREATE INDEX idx_bayesian_results_date ON bayesian_analysis_results(analysis_date);
CREATE INDEX idx_bayesian_results_lr ON bayesian_analysis_results(lr_value);

-- ============================================================================
-- PART 6: DATABASE FUNCTIONS
-- ============================================================================

-- Function to automatically create master array when department is created
CREATE OR REPLACE FUNCTION create_department_master_array()
RETURNS TRIGGER AS $$
DECLARE
    new_master_array_id UUID;
BEGIN
    INSERT INTO master_arrays (department_id, name, description)
    VALUES (NEW.id, NEW.name || ' Master Array', 'Automatically created master array for ' || NEW.name)
    RETURNING id INTO new_master_array_id;
    
    UPDATE departments 
    SET master_array_id = new_master_array_id, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_department_master_array
    AFTER INSERT ON departments
    FOR EACH ROW
    EXECUTE FUNCTION create_department_master_array();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at columns
CREATE TRIGGER trigger_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_master_arrays_updated_at BEFORE UPDATE ON master_arrays FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_master_array_profiles_updated_at BEFORE UPDATE ON master_array_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_expert_groups_updated_at BEFORE UPDATE ON expert_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_task_comments_updated_at BEFORE UPDATE ON task_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_task_results_updated_at BEFORE UPDATE ON task_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 7: INITIAL DATA - STR LOCI CONFIGURATION
-- ============================================================================

INSERT INTO str_loci_config (locus_name, display_order, description) VALUES
('D3S1358', 1, 'STR locus D3S1358'),
('vWA', 2, 'von Willebrand factor A'),
('D16S539', 3, 'STR locus D16S539'),
('CSF1PO', 4, 'c-fms proto-oncogene for CSF-1 receptor'),
('TPOX', 5, 'Thyroid peroxidase'),
('D8S1179', 6, 'STR locus D8S1179'),
('D21S11', 7, 'STR locus D21S11'),
('D18S51', 8, 'STR locus D18S51'),
('D2S441', 9, 'STR locus D2S441'),
('D19S433', 10, 'STR locus D19S433'),
('TH01', 11, 'Tyrosine hydroxylase'),
('FGA', 12, 'Fibrinogen alpha chain'),
('D22S1045', 13, 'STR locus D22S1045'),
('D5S818', 14, 'STR locus D5S818'),
('D13S317', 15, 'STR locus D13S317'),
('D7S820', 16, 'STR locus D7S820'),
('D6S1043', 17, 'STR locus D6S1043'),
('D10S1248', 18, 'STR locus D10S1248'),
('D1S1656', 19, 'STR locus D1S1656'),
('D12S391', 20, 'STR locus D12S391'),
('D2S1338', 21, 'STR locus D2S1338'),
('AMEL', 22, 'Amelogenin'),
('D9S1122', 23, 'STR locus D9S1122'),
('D18S853', 24, 'STR locus D18S853'),
('D17S906', 25, 'STR locus D17S906'),
('D4S2408', 26, 'STR locus D4S2408'),
('D8S1132', 27, 'STR locus D8S1132'),
('D1S1677', 28, 'STR locus D1S1677'),
('D20S482', 29, 'STR locus D20S482'),
('D14S1434', 30, 'STR locus D14S1434'),
('D11S4463', 31, 'STR locus D11S4463'),
('D15S659', 32, 'STR locus D15S659'),
('D3S4529', 33, 'STR locus D3S4529'),
('D16S753', 34, 'STR locus D16S753'),
('D17S1301', 35, 'STR locus D17S1301'),
('D18S1364', 36, 'STR locus D18S1364'),
('D2S1776', 37, 'STR locus D2S1776'),
('D4S2366', 38, 'STR locus D4S2366'),
('D1S1627', 39, 'STR locus D1S1627'),
('rs2032678', 40, 'SNP marker rs2032678 - Extended analysis marker'),
('Yindel', 41, 'Y chromosome indel marker'),
('DYS391', 42, 'Y chromosome STR marker');

-- ============================================================================
-- PART 8: INITIAL DATA - ORGANIZATION, DEPARTMENTS, ADMIN USER
-- ============================================================================

-- Create organization "СМЭ"
INSERT INTO organizations (name, description, is_active) VALUES 
('СМЭ', 'Судебно-медицинская экспертиза', true);

-- Get the organization ID and create departments and admin user
DO $$
DECLARE
    org_id UUID;
    dept_cs_id UUID;
    dept_genetics_id UUID;
    admin_password_hash TEXT;
BEGIN
    admin_password_hash := NULLIF(current_setting('app.admin_password_hash', true), '');
    IF admin_password_hash IS NULL THEN
        RAISE EXCEPTION 'Set app.admin_password_hash to a bcrypt hash before initializing the database';
    END IF;
    -- Get the organization ID
    SELECT id INTO org_id FROM organizations WHERE name = 'СМЭ' LIMIT 1;
    
    -- Create departments (master arrays will be created automatically by trigger)
    INSERT INTO departments (organization_id, name, description, is_active) VALUES 
    (org_id, 'ЧС', 'Чрезвычайные ситуации', true),
    (org_id, 'Генетические экспертизы', 'Отдел генетических экспертиз', true);
    
    -- Get department IDs
    SELECT id INTO dept_cs_id FROM departments WHERE organization_id = org_id AND name = 'ЧС' LIMIT 1;
    SELECT id INTO dept_genetics_id FROM departments WHERE organization_id = org_id AND name = 'Генетические экспертизы' LIMIT 1;
    
    -- Create expert groups for each department
    INSERT INTO expert_groups (department_id, name, description, is_active, created_by) 
    SELECT dept_cs_id, 'Эксперты ЧС', 'Группа экспертов по чрезвычайным ситуациям', true, 
           (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
    WHERE EXISTS (SELECT 1 FROM users WHERE username = 'admin');
    
    INSERT INTO expert_groups (department_id, name, description, is_active, created_by) 
    SELECT dept_genetics_id, 'Генетики', 'Группа генетических экспертов', true,
           (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
    WHERE EXISTS (SELECT 1 FROM users WHERE username = 'admin');
    
    -- Create admin user from a bcrypt hash supplied for this installation.
    INSERT INTO users (organization_id, department_id, username, email, password_hash, role, is_active) VALUES 
    (org_id, dept_cs_id, 'admin', 'admin@sme.local', admin_password_hash, 'admin', true)
    ON CONFLICT (username) DO UPDATE 
    SET organization_id = EXCLUDED.organization_id,
        department_id = EXCLUDED.department_id;
    
    -- Update expert groups with admin as creator (if they were created before admin user)
    UPDATE expert_groups 
    SET created_by = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
    WHERE created_by IS NULL;
    
    RAISE NOTICE 'Organization "СМЭ" created with ID: %', org_id;
    RAISE NOTICE 'Department "ЧС" created with ID: %', dept_cs_id;
    RAISE NOTICE 'Department "Генетические экспертизы" created with ID: %', dept_genetics_id;
    RAISE NOTICE 'Admin user created successfully';
END $$;

-- ============================================================================
-- PART 9: VIEWS FOR COMMON QUERIES
-- ============================================================================

CREATE VIEW active_profiles AS
SELECT 
    dp.*,
    u.username,
    u.email,
    u.department_id AS owner_department_id,
    d.name as department_name,
    o.name as organization_name
FROM dna_profiles dp
JOIN users u ON dp.user_id = u.id
LEFT JOIN departments d ON COALESCE(dp.department_id, u.department_id) = d.id
LEFT JOIN organizations o ON COALESCE(dp.organization_id, u.organization_id) = o.id
WHERE dp.is_active = true AND u.is_active = true;

CREATE VIEW recent_matches AS
SELECT 
    mr.*,
    p1.sample_name as profile1_name,
    p2.sample_name as profile2_name,
    u.username as analyzed_by_username
FROM match_results mr
JOIN dna_profiles p1 ON mr.profile_id_1 = p1.id
JOIN dna_profiles p2 ON mr.profile_id_2 = p2.id
JOIN users u ON mr.analyzed_by = u.id
ORDER BY mr.analysis_date DESC;

CREATE VIEW department_master_profiles AS
SELECT 
    map.*,
    ma.name as master_array_name,
    d.name as department_name,
    o.name as organization_name,
    u.username as created_by_username
FROM master_array_profiles map
JOIN master_arrays ma ON map.master_array_id = ma.id
JOIN departments d ON ma.department_id = d.id
JOIN organizations o ON d.organization_id = o.id
JOIN users u ON map.created_by = u.id
WHERE map.is_active = true AND ma.is_active = true AND d.is_active = true AND o.is_active = true;

CREATE VIEW task_assignments AS
SELECT 
    t.*,
    d.name as department_name,
    o.name as organization_name,
    creator.username as created_by_username,
    assignee.username as assigned_user_username,
    eg.name as assigned_group_name,
    approver.username as approved_by_username
FROM tasks t
JOIN departments d ON t.department_id = d.id
JOIN organizations o ON d.organization_id = o.id
JOIN users creator ON t.created_by = creator.id
LEFT JOIN users assignee ON t.assigned_to_user = assignee.id
LEFT JOIN expert_groups eg ON t.assigned_to_group = eg.id
LEFT JOIN users approver ON t.approved_by = approver.id
WHERE t.is_active = true AND d.is_active = true AND o.is_active = true;

-- ============================================================================
-- PART 10: PERMISSIONS
-- ============================================================================

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dna_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dna_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dna_user;

-- ============================================================================
-- INITIALIZATION COMPLETE
-- ============================================================================
-- Organization: СМЭ
-- Departments: ЧС, Генетические экспертизы
-- Admin User: admin; bcrypt hash must be supplied as app.admin_password_hash.
-- Ready for production use
-- ============================================================================

ALTER TABLE master_array_profiles ADD CONSTRAINT master_array_profiles_import_year_check CHECK (year IS NOT NULL OR COALESCE(metadata->>'importFormat', 'emergency') = 'genetic');
CREATE UNIQUE INDEX idx_master_array_genetic_object ON master_array_profiles (master_array_id, lower(btrim(internal_number))) WHERE is_active = true AND metadata->>'importFormat' = 'genetic';

-- Необязательные генетические панели (029), без фиктивных определений.
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

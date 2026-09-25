/* ==========================================================================
   notification_log.sql

   Report a Concern (RAC): SQL-only pieces of the schema.

   The geodatabase-managed way to build the RAC schema is build_schema.py
   (arcpy). This file covers the parts that arcpy does not create, plus a
   reference definition of Notification_Log for teams that prefer to create
   that one table with plain T-SQL and then register it with the geodatabase.

   Contents
     1. Ticket number sequence used by the RAC_TicketNumber_Sequence
        attribute rule (SQL only; arcpy has no tool for this).
     2. Notification_Log table definition (reference / alternative).
     3. Recommended nonclustered indexes.

   Run as the data owner against database ReportAConcern.
   ========================================================================== */

USE ReportAConcern;
GO

/* --------------------------------------------------------------------------
   1. Ticket number sequence

   The Arcade calculation rule RAC_TicketNumber_Sequence calls
   NextSequenceValue("RAC_TicketNumber_Sequence"). ArcGIS looks for a
   database sequence of that name owned by the data owner. Human-readable
   ticket numbers start at 10000.
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'RAC_TicketNumber_Sequence')
BEGIN
    CREATE SEQUENCE dbo.RAC_TicketNumber_Sequence
        AS BIGINT
        START WITH 10000
        INCREMENT BY 1
        NO CYCLE
        CACHE 20;
END
GO

/* Quick check: SELECT NEXT VALUE FOR dbo.RAC_TicketNumber_Sequence;  (consumes one value) */

/* --------------------------------------------------------------------------
   2. Notification_Log (reference definition)

   IMPORTANT: Notification_Log must stay UNVERSIONED. Every writer (the
   automation scripts in scripts/ and the Flask proxy in proxy/) inserts
   with direct SQL and supplies OBJECTID = MAX(OBJECTID) + 1 itself, retrying
   on a duplicate key. They do not go through an edit session, so the table
   must never be registered as versioned or archived. If it were versioned,
   direct inserts would bypass the delta tables and be lost or hidden on
   Compress.

   If you create the table here instead of with build_schema.py, register it
   with the geodatabase afterwards so it can be published, but do NOT
   register it as versioned:

       arcpy.management.RegisterWithGeodatabase(
           r"...\ReportAConcern_owner.sde\Notification_Log")

   build_schema.py creates the same table through arcpy; use one method or
   the other, not both.
   -------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Notification_Log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Notification_Log (
        OBJECTID        INT              NOT NULL,
        log_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Notification_Log_log_id DEFAULT NEWID(),
        ticket_id       UNIQUEIDENTIFIER NULL,
        script_name     NVARCHAR(100)    NULL,
        recipient_email NVARCHAR(254)    NULL,
        email_subject   NVARCHAR(255)    NULL,
        send_status     NVARCHAR(20)     NULL,   -- SENT, FAILED, SKIPPED, INFO, ...
        error_message   NVARCHAR(500)    NULL,
        sent_date       DATETIME2(0)     NULL,
        retry_count     SMALLINT         NULL CONSTRAINT DF_Notification_Log_retry_count DEFAULT 0,
        CONSTRAINT PK_Notification_Log PRIMARY KEY CLUSTERED (OBJECTID)
    );
END
GO

/* --------------------------------------------------------------------------
   3. Recommended nonclustered indexes

   These support the lookups that the attribute rules and the automation
   scripts perform. build_schema.py creates the geodatabase-managed
   equivalents with arcpy.management.AddIndex; the statements below are the
   same indexes expressed as T-SQL for reference or for a SQL-only build.
   Index names may differ from what arcpy generates; the column sets are
   what matter.
   -------------------------------------------------------------------------- */

-- Notification_Log: recent events per ticket, and failures to retry.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notification_Log_Ticket_Date')
    CREATE NONCLUSTERED INDEX IX_Notification_Log_Ticket_Date
        ON dbo.Notification_Log (ticket_id, sent_date DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notification_Log_Status_Date')
    CREATE NONCLUSTERED INDEX IX_Notification_Log_Status_Date
        ON dbo.Notification_Log (send_status, sent_date DESC);
GO

-- Service_Boundaries: active boundary filter used by RAC_Geofence_Validate.
IF OBJECT_ID('dbo.Service_Boundaries', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SB_Active_Boundary')
    CREATE NONCLUSTERED INDEX IX_SB_Active_Boundary
        ON dbo.Service_Boundaries (is_active, boundary_id);
GO

-- Category_Boundary_Lookup: (category, boundary_id, is_valid) lookup.
IF OBJECT_ID('dbo.Category_Boundary_Lookup', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CBL_Cat_Boundary_Valid')
    CREATE NONCLUSTERED INDEX IX_CBL_Cat_Boundary_Valid
        ON dbo.Category_Boundary_Lookup (category, boundary_id, is_valid);
GO

-- Ticket_Routing: two-tier routing lookup used by RAC_Geofence_Route.
IF OBJECT_ID('dbo.Ticket_Routing', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TR_Cat_Sub_Boundary_Active')
    CREATE NONCLUSTERED INDEX IX_TR_Cat_Sub_Boundary_Active
        ON dbo.Ticket_Routing (category, subcategory, boundary_id, is_active);
GO

-- Tickets: ticket_number lookup from the status page and the scripts.
IF OBJECT_ID('dbo.Tickets', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tickets_Number')
    CREATE NONCLUSTERED INDEX IX_Tickets_Number
        ON dbo.Tickets (ticket_number);
GO

-- Ticket_Comments: the comments mailer polls is_public = 1 AND email_sent = 0.
IF OBJECT_ID('dbo.Ticket_Comments', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TC_Public_EmailSent')
    CREATE NONCLUSTERED INDEX IX_TC_Public_EmailSent
        ON dbo.Ticket_Comments (is_public, email_sent);
GO

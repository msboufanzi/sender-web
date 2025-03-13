from flask import Flask, request, jsonify, redirect, session
from flask_cors import CORS
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib
import os
import csv
import time
import threading
import queue
import json
import base64
import secrets
import logging
import uuid
from datetime import timedelta
from dotenv import load_dotenv
import google.oauth2.credentials
import google_auth_oauthlib.flow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# Set up logging
logging.basicConfig(level=logging.DEBUG, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    handlers=[logging.StreamHandler()])
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Use environment variable for secret key
app.secret_key = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# Configure session
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() in ['true', '1']
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=1)

# Configure CORS to allow credentials
CORS(app, 
     supports_credentials=True, 
     origins=[os.getenv('FRONTEND_URL', 'http://localhost:3000')], 
     allow_headers=["Content-Type", "Authorization"],
     expose_headers=["Set-Cookie"])

# Google OAuth Configuration
CLIENT_SECRETS_FILE = 'client_secret.json'
# Gmail API requires specific scopes for sending emails and accessing profile
SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',  # Added for profile access
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
]
API_SERVICE_NAME = 'gmail'
API_VERSION = 'v1'

# Global Variables
contact_queue = queue.Queue()
send_lock = threading.Lock()
email_templates = {
    'EN': 'Default English template. Hello [NAME]',  # Default template
}
campaign_status = {
    'is_running': False,
    'remaining': 0,
    'total': 0,
    'errors': [],
    'completed': False
}

# Store email accounts (both Gmail OAuth and SMTP)
email_accounts = {}

# Store uploaded files
data_folder = 'data'
os.makedirs(data_folder, exist_ok=True)

# Save client secrets to file
def save_client_secrets():
    client_secrets = {
        "web": {
            "client_id": os.getenv('CLIENT_ID'),
            "project_id": os.getenv('PROJECT_ID'),
            "auth_uri": os.getenv('AUTH_URI', 'https://accounts.google.com/o/oauth2/auth'),
            "token_uri": os.getenv('TOKEN_URI', 'https://oauth2.googleapis.com/token'),
            "auth_provider_x509_cert_url": os.getenv('AUTH_PROVIDER_X509_CERT_URL', 'https://www.googleapis.com/oauth2/v1/certs'),
            "client_secret": os.getenv('CLIENT_SECRET'),
            "redirect_uris": [os.getenv('REDIRECT_URI', 'http://localhost:5000/callback')]
        }
    }
    try:
        with open(CLIENT_SECRETS_FILE, 'w') as f:
            json.dump(client_secrets, f)
        logger.info(f"Client secrets saved to {CLIENT_SECRETS_FILE}")
        return True
    except Exception as e:
        logger.error(f"Error saving client secrets: {str(e)}")
        return False

# Create client_secret.json file
if not save_client_secrets():
    logger.error("Failed to create client_secret.json file. OAuth will not work.")

@app.route('/')
def index():
    return "Email Automation Backend Running!"

@app.route('/get-oauth-url', methods=['GET'])
def get_oauth_url():
    try:
        # Make the session permanent
        session.permanent = True
        
        # Check if client_secret.json exists
        if not os.path.exists(CLIENT_SECRETS_FILE):
            if not save_client_secrets():
                return jsonify({"error": "Failed to create client_secret.json file"}), 500
        
        # Create flow instance to manage the OAuth 2.0 Authorization Grant Flow
        flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE, scopes=SCOPES)

        # The URI created here must exactly match one of the authorized redirect URIs
        flow.redirect_uri = os.getenv('REDIRECT_URI', 'http://localhost:5000/callback')
        logger.debug(f"Redirect URI: {flow.redirect_uri}")

        # Generate a state token to prevent request forgery
        state = secrets.token_urlsafe(16)
        session['state'] = state
        logger.debug(f"Generated state: {state}")
        logger.debug(f"Session after setting state: {dict(session)}")

        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent')
        
        logger.info(f"Generated OAuth URL: {authorization_url}")
        return jsonify({"url": authorization_url})
    except Exception as e:
        logger.error(f"Error generating OAuth URL: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/login')
def login():
    try:
        # Make the session permanent
        session.permanent = True
        
        # Check if client_secret.json exists
        if not os.path.exists(CLIENT_SECRETS_FILE):
            if not save_client_secrets():
                return "Failed to create client_secret.json file", 500
        
        # Create flow instance to manage the OAuth 2.0 Authorization Grant Flow
        flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE, scopes=SCOPES)

        # The URI created here must exactly match one of the authorized redirect URIs
        flow.redirect_uri = os.getenv('REDIRECT_URI', 'http://localhost:5000/callback')
        logger.debug(f"Redirect URI: {flow.redirect_uri}")

        # Generate a state token to prevent request forgery
        state = secrets.token_urlsafe(16)
        session['state'] = state
        logger.debug(f"Generated state: {state}")
        logger.debug(f"Session after setting state: {dict(session)}")

        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent')
        
        logger.info(f"Redirecting to OAuth URL: {authorization_url}")
        return redirect(authorization_url)
    except Exception as e:
        logger.error(f"Error in login route: {str(e)}")
        return f"Error: {str(e)}", 500

@app.route('/callback')
def oauth2callback():
    try:
        # Debug session and cookies
        logger.debug(f"All session data: {dict(session)}")
        logger.debug(f"Request cookies: {request.cookies}")
        
        # Check if state exists in session
        if 'state' not in session:
            error_message = "No state found in session. Please try again."
            logger.error(error_message)
            # Try to recover by using the state from the request
            state = request.args.get('state')
            if not state:
                return error_page(error_message)
            logger.info(f"Attempting to recover using state from request: {state}")
        else:
            state = session['state']
            logger.debug(f"State from session: {state}")
        
        # Check if client_secret.json exists
        if not os.path.exists(CLIENT_SECRETS_FILE):
            error_message = "Client secret file not found"
            logger.error(error_message)
            return error_page(error_message)
        
        # Create a flow with the state from either session or request
        flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE, scopes=SCOPES, state=state)
        flow.redirect_uri = os.getenv('REDIRECT_URI', 'http://localhost:5000/callback')

        # Use the authorization server's response to fetch the OAuth 2.0 tokens
        authorization_response = request.url
        logger.debug(f"Authorization response: {authorization_response}")
        
        try:
            flow.fetch_token(authorization_response=authorization_response)
        except Exception as token_error:
            error_message = f"Error fetching token: {str(token_error)}"
            logger.error(error_message)
            return error_page(error_message)

        # Store credentials in the session
        credentials = flow.credentials
        session['credentials'] = {
            'token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_uri': credentials.token_uri,
            'client_id': credentials.client_id,
            'client_secret': credentials.client_secret,
            'scopes': credentials.scopes
        }
        
        logger.debug(f"Credentials stored in session: {session.get('credentials')}")

        # Get user email
        try:
            service = build('gmail', 'v1', credentials=credentials)
            profile = service.users().getProfile(userId='me').execute()
            user_email = profile['emailAddress']
            logger.info(f"Successfully got user email: {user_email}")
        except Exception as profile_error:
            # If we can't get the profile, try to extract email from the ID token
            logger.error(f"Error getting user profile: {str(profile_error)}")
            try:
                # Parse the ID token to get the email
                import jwt
                id_token = credentials.id_token
                decoded = jwt.decode(id_token, options={"verify_signature": False})
                user_email = decoded.get('email')
                if not user_email:
                    raise ValueError("Email not found in ID token")
                logger.info(f"Got email from ID token: {user_email}")
            except Exception as jwt_error:
                logger.error(f"Error extracting email from ID token: {str(jwt_error)}")
                return error_page(f"Could not get user email: {str(profile_error)}")
        
        # Store account in email_accounts
        account_id = str(uuid.uuid4())
        email_accounts[account_id] = {
            'id': account_id,
            'type': 'gmail',
            'email': user_email,
            'name': user_email.split('@')[0],
            'isConnected': True,
            'credentials': {
                'token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_uri': credentials.token_uri,
                'client_id': credentials.client_id,
                'client_secret': credentials.client_secret,
                'scopes': credentials.scopes
            }
        }
        
        logger.info(f"OAuth account stored for {user_email}")

        # Return HTML that will send a message to the opener and close itself
        return success_page(user_email)
    except Exception as e:
        error_message = str(e)
        logger.error(f"OAuth callback error: {error_message}")
        return error_page(error_message)

def success_page(email):
    """Generate success HTML page"""
    return f"""
    <html>
    <head>
        <title>Authentication Successful</title>
        <style>
            body {{ font-family: Arial, sans-serif; text-align: center; padding: 40px; }}
            .success {{ color: green; }}
            .container {{ max-width: 500px; margin: 0 auto; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2 class="success">Authentication Successful!</h2>
            <p>You have successfully connected your Gmail account: <strong>{email}</strong></p>
            <p>You can now close this window and return to the application.</p>
        </div>
        <script>
            // Try different ways to communicate with the opener
            try {{
                if (window.opener && !window.opener.closed) {{
                    window.opener.postMessage({{
                        type: 'oauth_callback',
                        success: true,
                        email: '{email}'
                    }}, "*");  // Use * to ensure message delivery
                    
                    // Also try direct function call as fallback
                    if (typeof window.opener.onOAuthCallback === 'function') {{
                        window.opener.onOAuthCallback(true, '{email}');
                    }}
                }}
            }} catch (e) {{
                console.error("Error sending message to opener:", e);
            }}
            
            // Close this window after a delay
            setTimeout(function() {{ window.close(); }}, 3000);
        </script>
    </body>
    </html>
    """

def error_page(error_message):
    """Generate error HTML page"""
    safe_error = error_message.replace("'", "\\'").replace('"', '\\"')
    return f"""
    <html>
    <head>
        <title>Authentication Failed</title>
        <style>
            body {{ font-family: Arial, sans-serif; text-align: center; padding: 40px; }}
            .error {{ color: red; }}
            .container {{ max-width: 500px; margin: 0 auto; }}
            .details {{ background: #f8f8f8; padding: 10px; text-align: left; margin-top: 20px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2 class="error">Authentication Failed</h2>
            <p>There was a problem connecting your Gmail account.</p>
            <div class="details">
                <p><strong>Error details:</strong> {safe_error}</p>
            </div>
            <p>Please close this window and try again.</p>
        </div>
        <script>
            // Try different ways to communicate with the opener
            try {{
                if (window.opener && !window.opener.closed) {{
                    window.opener.postMessage({{
                        type: 'oauth_callback',
                        success: false,
                        message: '{safe_error}'
                    }}, "*");  // Use * to ensure message delivery
                    
                    // Also try direct function call as fallback
                    if (typeof window.opener.onOAuthCallback === 'function') {{
                        window.opener.onOAuthCallback(false, null, '{safe_error}');
                    }}
                }}
            }} catch (e) {{
                console.error("Error sending message to opener:", e);
            }}
            
            // Close this window after a delay
            setTimeout(function() {{ window.close(); }}, 5000);
        </script>
    </body>
    </html>
    """

@app.route('/smtp/accounts', methods=['GET'])
def get_accounts():
    """Get all email accounts (both Gmail and SMTP)"""
    return jsonify({"accounts": list(email_accounts.values())})

@app.route('/smtp/accounts', methods=['POST'])
def add_smtp_account():
    """Add a new SMTP account"""
    try:
        data = request.json
        
        # Validate required fields
        if not all([data.get('name'), data.get('email'), data.get('host'), 
                   data.get('port'), data.get('username'), data.get('password')]):
            return jsonify({"error": "All fields are required"}), 400
        
        # Create a new account ID
        account_id = str(uuid.uuid4())
        
        # Store the account
        email_accounts[account_id] = {
            'id': account_id,
            'type': 'smtp',
            'name': data['name'],
            'email': data['email'],
            'host': data['host'],
            'port': data['port'],
            'username': data['username'],
            'password': data['password'],
            'use_ssl': data.get('use_ssl', False),
            'isConnected': False  # Will be set to True after testing
        }
        
        logger.info(f"SMTP account added: {data['email']}")
        return jsonify({"message": "SMTP account added successfully", "id": account_id})
    except Exception as e:
        logger.error(f"Error adding SMTP account: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/smtp/accounts/<account_id>', methods=['DELETE'])
def delete_account(account_id):
    """Delete an email account"""
    if account_id in email_accounts:
        del email_accounts[account_id]
        logger.info(f"Account deleted: {account_id}")
        return jsonify({"message": "Account deleted successfully"})
    return jsonify({"error": "Account not found"}), 404

@app.route('/smtp/test', methods=['POST'])
def test_account():
    """Test an email account connection"""
    try:
        data = request.json
        account_id = data.get('accountId')
        test_email = data.get('testEmail')
        
        if not account_id:
            return jsonify({"error": "Account ID is required"}), 400
            
        if account_id not in email_accounts:
            return jsonify({"error": "Account not found"}), 404
            
        account = email_accounts[account_id]
        
        # Test the account based on its type
        if account['type'] == 'gmail':
            # Test Gmail OAuth account
            try:
                credentials = Credentials(
                    token=account['credentials']['token'],
                    refresh_token=account['credentials']['refresh_token'],
                    token_uri=account['credentials']['token_uri'],
                    client_id=account['credentials']['client_id'],
                    client_secret=account['credentials']['client_secret'],
                    scopes=account['credentials']['scopes']
                )
                
                service = build('gmail', 'v1', credentials=credentials)
                
                # Just get the profile to test the connection
                profile = service.users().getProfile(userId='me').execute()
                
                # If test email is provided, send a test email
                if test_email:
                    message = MIMEMultipart()
                    message['to'] = test_email
                    message['subject'] = "Test Email from Email Automation System"
                    
                    body = "This is a test email to verify your Gmail account connection."
                    message.attach(MIMEText(body, 'plain'))
                    
                    # Encode the message
                    encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
                    
                    # Create the message
                    create_message = {
                        'raw': encoded_message
                    }
                    
                    # Send the message
                    send_message = service.users().messages().send(
                        userId="me", body=create_message).execute()
                
                # Update account status
                email_accounts[account_id]['isConnected'] = True
                
                logger.info(f"Gmail account tested successfully: {account['email']}")
                return jsonify({"message": "Gmail account connection successful"})
            except Exception as e:
                logger.error(f"Error testing Gmail account: {str(e)}")
                email_accounts[account_id]['isConnected'] = False
                return jsonify({"error": f"Gmail API Error: {str(e)}"}), 400
        else:
            # Test SMTP account
            try:
                host = account['host']
                port = account['port']
                username = account['username']
                password = account['password']
                use_ssl = account.get('use_ssl', False)
                
                # If test email is provided, send a test email
                if test_email:
                    msg = MIMEMultipart()
                    msg['From'] = username
                    msg['To'] = test_email
                    msg['Subject'] = "Test Email from Email Automation System"
                    
                    body = "This is a test email to verify your SMTP configuration is working correctly."
                    msg.attach(MIMEText(body, 'plain'))
                    
                    if use_ssl:
                        server = smtplib.SMTP_SSL(host, port)
                    else:
                        server = smtplib.SMTP(host, port)
                        server.starttls()
                        
                    server.login(username, password)
                    
                    if test_email:
                        server.send_message(msg)
                    
                    server.quit()
                else:
                    # Just test the connection without sending an email
                    if use_ssl:
                        server = smtplib.SMTP_SSL(host, port)
                    else:
                        server = smtplib.SMTP(host, port)
                        server.starttls()
                        
                    server.login(username, password)
                    server.quit()
                
                # Update account status
                email_accounts[account_id]['isConnected'] = True
                
                logger.info(f"SMTP account tested successfully: {account['email']}")
                return jsonify({"message": "SMTP account connection successful"})
            except Exception as e:
                logger.error(f"Error testing SMTP account: {str(e)}")
                email_accounts[account_id]['isConnected'] = False
                return jsonify({"error": f"SMTP Error: {str(e)}"}), 400
    except Exception as e:
        logger.error(f"Error testing account: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/gmail-status', methods=['GET'])
def gmail_status():
    email = request.args.get('email')
    
    # Check if the email exists in any of the accounts
    for account_id, account in email_accounts.items():
        if account['type'] == 'gmail' and account['email'] == email:
            return jsonify({"connected": True, "email": email, "accountId": account_id})
    
    return jsonify({"connected": False})

@app.route('/revoke-oauth', methods=['POST'])
def revoke_oauth():
    account_id = request.args.get('accountId')
    if account_id and account_id in email_accounts:
        # Remove the account
        account = email_accounts.pop(account_id)
        logger.info(f"OAuth account revoked: {account['email']}")
        return jsonify({"message": "OAuth account revoked successfully"})
    return jsonify({"error": "Account not found or not connected"}), 404

@app.route('/save-smtp-config', methods=['POST'])
def save_smtp_config():
    try:
        config = request.json
        # Here you would typically save this to a database or config file
        # For this example, we'll just return success
        logger.info("SMTP configuration saved")
        return jsonify({"message": "SMTP configuration saved successfully"})
    except Exception as e:
        logger.error(f"Error saving SMTP config: {str(e)}")
        return jsonify({"error": str(e)}), 400

def process_contact(contact):
    """Process a single contact row with flexible format handling"""
    # Default values
    email = ""
    name = ""
    language = "EN"  # Default to English
    
    # Handle different CSV formats
    if len(contact) >= 1:
        email = contact[0]
    
    if len(contact) >= 2:
        name = contact[1]
    
    if len(contact) >= 4:  # Format: email, name, title, language
        language = contact[3]
    elif len(contact) >= 3:  # Format: email, name, language
        language = contact[2]
    
    return email, name, language

@app.route('/upload-contacts', methods=['POST'])
def upload_contacts():
    try:
        file = request.files['file']
        file_path = os.path.join(data_folder, 'contacts.csv')
        
        # Check if it's a CSV or TXT file
        if file.filename.endswith('.txt'):
            # Process TXT file (one email per line)
            with open(file_path, 'w', encoding='utf-8') as csv_file:
                csv_file.write("email,name,language\n")  # Write header
                for line in file:
                    email = line.decode('utf-8').strip()
                    if email:  # Skip empty lines
                        csv_file.write(f"{email},,EN\n")  # Default empty name and EN language
        else:
            # Save as CSV
            file.save(file_path)
        
        # Count total contacts
        with open(file_path, 'r') as f:
            total = sum(1 for line in f) - 1  # Subtract 1 for header
            if total < 0:
                total = 0
            campaign_status['total'] = total
            
        logger.info(f"Contacts uploaded: {total} contacts")
        return jsonify({
            "message": "Contacts uploaded successfully!", 
            "total": total
        })
    except Exception as e:
        logger.error(f"Error uploading contacts: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/get-contacts', methods=['GET'])
def get_contacts():
    try:
        file_path = os.path.join(data_folder, 'contacts.csv')
        if not os.path.exists(file_path):
            return jsonify({"contacts": []})
            
        contacts = []
        with open(file_path, 'r', encoding='utf-8') as file:
            reader = csv.reader(file)
            next(reader, None)  # Skip header
            for row in reader:
                email, name, language = process_contact(row)
                if email:  # Only include if email exists
                    contacts.append({
                        "email": email,
                        "name": name,
                        "language": language
                    })
        
        logger.debug(f"Retrieved {len(contacts)} contacts")
        return jsonify({"contacts": contacts})
    except Exception as e:
        logger.error(f"Error getting contacts: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/save-contacts', methods=['POST'])
def save_contacts():
    try:
        contacts = request.json.get('contacts', [])
        file_path = os.path.join(data_folder, 'contacts.csv')
        
        with open(file_path, 'w', encoding='utf-8', newline='') as file:
            writer = csv.writer(file)
            writer.writerow(['email', 'name', 'language'])  # Header
            for contact in contacts:
                writer.writerow([
                    contact.get('email', ''),
                    contact.get('name', ''),
                    contact.get('language', 'EN')
                ])
                
        # Update total count
        campaign_status['total'] = len(contacts)
        
        logger.info(f"Contacts saved: {len(contacts)} contacts")
        return jsonify({
            "message": "Contacts saved successfully!",
            "total": len(contacts)
        })
    except Exception as e:
        logger.error(f"Error saving contacts: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/upload-attachment', methods=['POST'])
def upload_attachment():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file part"}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400
            
        file_path = os.path.join(data_folder, file.filename)
        file.save(file_path)
        
        logger.info(f"Attachment uploaded: {file.filename}")
        return jsonify({
            "message": "Attachment uploaded successfully!",
            "filename": file.filename
        })
    except Exception as e:
        logger.error(f"Error uploading attachment: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/get-attachments', methods=['GET'])
def get_attachments():
    try:
        attachments = []
        for filename in os.listdir(data_folder):
            if filename != 'contacts.csv':
                file_path = os.path.join(data_folder, filename)
                file_size = os.path.getsize(file_path)
                attachments.append({
                    "filename": filename,
                    "size": file_size
                })
        
        logger.debug(f"Retrieved {len(attachments)} attachments")
        return jsonify({"attachments": attachments})
    except Exception as e:
        logger.error(f"Error getting attachments: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/delete-attachment', methods=['POST'])
def delete_attachment():
    try:
        filename = request.json.get('filename')
        if not filename:
            return jsonify({"error": "No filename provided"}), 400
            
        file_path = os.path.join(data_folder, filename)
        if os.path.exists(file_path) and filename != 'contacts.csv':
            os.remove(file_path)
            logger.info(f"Attachment deleted: {filename}")
            return jsonify({"message": f"Attachment {filename} deleted successfully"})
        else:
            return jsonify({"error": "File not found"}), 404
    except Exception as e:
        logger.error(f"Error deleting attachment: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/save-templates', methods=['POST'])
def save_templates():
    global email_templates
    try:
        templates = request.json
        if not templates or not any(templates.values()):
            return jsonify({"error": "At least one template is required"}), 400
            
        email_templates = templates
        logger.info(f"Email templates saved: {len(templates)} templates")
        return jsonify({"message": "Email templates saved successfully!"})
    except Exception as e:
        logger.error(f"Error saving templates: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/get-templates', methods=['GET'])
def get_templates():
    return jsonify({"templates": email_templates})

@app.route('/test-email', methods=['POST'])
def test_email():
    try:
        data = request.json
        test_email = data.get('test_email')
        account_id = data.get('accountId')
        
        if not test_email:
            return jsonify({"error": "Test email address is required"}), 400
            
        if not account_id or account_id not in email_accounts:
            return jsonify({"error": "Valid account ID is required"}), 400
            
        account = email_accounts[account_id]
        
        if account['type'] == 'gmail':
            # Send test email using Gmail API
            try:
                credentials = Credentials(
                    token=account['credentials']['token'],
                    refresh_token=account['credentials']['refresh_token'],
                    token_uri=account['credentials']['token_uri'],
                    client_id=account['credentials']['client_id'],
                    client_secret=account['credentials']['client_secret'],
                    scopes=account['credentials']['scopes']
                )
                
                service = build('gmail', 'v1', credentials=credentials)
                
                message = MIMEMultipart()
                message['to'] = test_email
                message['subject'] = "Test Email from Email Automation System"
                
                body = "This is a test email to verify your Gmail account connection."
                message.attach(MIMEText(body, 'plain'))
                
                # Encode the message
                encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
                
                # Create the message
                create_message = {
                    'raw': encoded_message
                }
                
                # Send the message
                send_message = service.users().messages().send(
                    userId="me", body=create_message).execute()
                
                logger.info(f"Test email sent via Gmail API to {test_email}")
                return jsonify({"message": "Test email sent successfully via Gmail API"})
            except Exception as e:
                logger.error(f"Gmail API Error: {str(e)}")
                return jsonify({"error": f"Gmail API Error: {str(e)}"}), 400
        else:
            # Send test email using SMTP
            try:
                host = account['host']
                port = account['port']
                username = account['username']
                password = account['password']
                use_ssl = account.get('use_ssl', False)
                
                msg = MIMEMultipart()
                msg['From'] = username
                msg['To'] = test_email
                msg['Subject'] = "Test Email from Email Automation System"
                
                body = "This is a test email to verify your SMTP configuration is working correctly."
                msg.attach(MIMEText(body, 'plain'))
                
                if use_ssl:
                    server = smtplib.SMTP_SSL(host, port)
                else:
                    server = smtplib.SMTP(host, port)
                    server.starttls()
                    
                server.login(username, password)
                server.send_message(msg)
                server.quit()
                
                logger.info(f"Test email sent via SMTP to {test_email}")
                return jsonify({"message": "Test email sent successfully via SMTP"})
            except Exception as e:
                logger.error(f"SMTP Error: {str(e)}")
                return jsonify({"error": f"SMTP Error: {str(e)}"}), 400
                
    except Exception as e:
        logger.error(f"Error sending test email: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/campaign-status', methods=['GET'])
def get_campaign_status():
    return jsonify({
        "isRunning": campaign_status['is_running'],
        "remaining": campaign_status['remaining'],
        "total": campaign_status['total'],
        "errors": campaign_status['errors'][-5:],  # Return last 5 errors
        "completed": campaign_status['completed'],
        "status": "running" if campaign_status['is_running'] else "completed"
    })

@app.route('/reset-campaign', methods=['POST'])
def reset_campaign():
    global campaign_status
    campaign_status = {
        'is_running': False,
        'remaining': 0,
        'total': 0,
        'errors': [],
        'completed': False
    }
    logger.info("Campaign status reset")
    return jsonify({"message": "Campaign status reset successfully"})

@app.route('/send-emails', methods=['POST'])
def send_emails():
    global campaign_status
    
    try:
        data = request.json
        selected_account_ids = data.get('selectedAccounts', [])
        
        if not selected_account_ids:
            return jsonify({"error": "Please select at least one email account"}), 400
            
        # Validate that all selected accounts exist and are connected
        valid_accounts = []
        for account_id in selected_account_ids:
            if account_id in email_accounts:
                account = email_accounts[account_id]
                if account['isConnected']:
                    valid_accounts.append(account)
                else:
                    return jsonify({"error": f"Account {account['email']} is not connected"}), 400
            else:
                return jsonify({"error": f"Account ID {account_id} not found"}), 400
                
        if not valid_accounts:
            return jsonify({"error": "No valid connected accounts selected"}), 400
        
        subject = data['subject']
        delay = int(data.get('pauseBetweenMessages', 5))
        retries = int(data.get('retries', 1))
        max_connections = int(data.get('maxConnections', 5))

        # Reset campaign status
        campaign_status['errors'] = []
        campaign_status['is_running'] = True
        campaign_status['completed'] = False
        
        # Check if templates exist
        if not email_templates or not any(email_templates.values()):
            return jsonify({"error": "Please save at least one email template first"}), 400

        # Load contacts
        contacts_path = os.path.join(data_folder, 'contacts.csv')
        if not os.path.exists(contacts_path):
            return jsonify({"error": "No contacts file found"}), 400

        contacts = []
        with open(contacts_path, mode='r', encoding='utf-8') as file:
            reader = csv.reader(file)
            next(reader, None)  # Skip header
            for row in reader:
                email, name, language = process_contact(row)
                if email:  # Only include if email exists
                    contacts.append((email, name, language))

        if not contacts:
            return jsonify({"error": "No valid contacts found in file"}), 400

        campaign_status['remaining'] = len(contacts)
        campaign_status['total'] = len(contacts)

        # Clear and fill queue
        while not contact_queue.empty():
            contact_queue.get()
        
        for contact in contacts:
            contact_queue.put(contact)

        def worker():
            account_index = 0
            while not contact_queue.empty():
                try:
                    email, name, language = contact_queue.get()
                    
                    # Get template with fallback to first available template
                    template = email_templates.get(language)
                    if not template:
                        # Try to get any template
                        for lang, tmpl in email_templates.items():
                            if tmpl:
                                template = tmpl
                                break
                    
                    if not template:
                        raise ValueError(f"No template found for language {language}")
                        
                    email_body = template.replace("[NAME]", name)
                    
                    # Round-robin: Get the next account
                    current_account = valid_accounts[account_index]
                    account_index = (account_index + 1) % len(valid_accounts)
                    
                    success = False
                    for attempt in range(retries + 1):
                        try:
                            if current_account['type'] == 'gmail':
                                # Send email using Gmail API
                                credentials = Credentials(
                                    token=current_account['credentials']['token'],
                                    refresh_token=current_account['credentials']['refresh_token'],
                                    token_uri=current_account['credentials']['token_uri'],
                                    client_id=current_account['credentials']['client_id'],
                                    client_secret=current_account['credentials']['client_secret'],
                                    scopes=current_account['credentials']['scopes']
                                )
                                
                                service = build('gmail', 'v1', credentials=credentials)
                                
                                message = MIMEMultipart()
                                message['to'] = email
                                message['subject'] = subject
                                message.attach(MIMEText(email_body, 'plain'))
                                
                                # Add attachments if any
                                for filename in os.listdir(data_folder):
                                    if filename != 'contacts.csv':
                                        attachment_path = os.path.join(data_folder, filename)
                                        with open(attachment_path, 'rb') as attachment:
                                            part = MIMEBase('application', 'octet-stream')
                                            part.set_payload(attachment.read())
                                            encoders.encode_base64(part)
                                            part.add_header('Content-Disposition', f'attachment; filename={filename}')
                                            message.attach(part)
                                
                                # Encode the message
                                encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
                                
                                # Create the message
                                create_message = {
                                    'raw': encoded_message
                                }
                                
                                # Send the message
                                send_message = service.users().messages().send(
                                    userId="me", body=create_message).execute()
                                
                                logger.info(f'Email sent to {email} via Gmail API using account {current_account["email"]}')
                                success = True
                                break
                            else:
                                # Send email using SMTP
                                host = current_account['host']
                                port = current_account['port']
                                username = current_account['username']
                                password = current_account['password']
                                use_ssl = current_account.get('use_ssl', False)
                                
                                msg = MIMEMultipart()
                                msg['From'] = username
                                msg['To'] = email
                                msg['Subject'] = subject
                                msg.attach(MIMEText(email_body, 'plain'))
                                
                                # Add attachments if any
                                for filename in os.listdir(data_folder):
                                    if filename != 'contacts.csv':
                                        attachment_path = os.path.join(data_folder, filename)
                                        with open(attachment_path, 'rb') as attachment:
                                            part = MIMEBase('application', 'octet-stream')
                                            part.set_payload(attachment.read())
                                            encoders.encode_base64(part)
                                            part.add_header('Content-Disposition', f'attachment; filename={filename}')
                                            msg.attach(part)
                                
                                if use_ssl:
                                    server = smtplib.SMTP_SSL(host, port)
                                else:
                                    server = smtplib.SMTP(host, port)
                                    server.starttls()
                                
                                server.login(username, password)
                                server.send_message(msg)
                                server.quit()
                                
                                logger.info(f'Email sent to {email} via SMTP using account {current_account["email"]}')
                                success = True
                                break
                        except Exception as e:
                            logger.error(f'Error sending to {email} using account {current_account["email"]}: {e}')
                            if attempt < retries:
                                # Try the next account in the round-robin for the retry
                                current_account = valid_accounts[account_index]
                                account_index = (account_index + 1) % len(valid_accounts)
                                time.sleep(2)
                            else:
                                campaign_status['errors'].append(f"Failed to send to {email}: {str(e)}")
                    
                    if not success:
                        logger.error(f"Failed to send email to {email} after {retries + 1} attempts")
                    
                    with send_lock:
                        campaign_status['remaining'] -= 1
                        
                    contact_queue.task_done()
                    time.sleep(delay)
                except Exception as e:
                    logger.error(f"Worker error: {e}")
                    campaign_status['errors'].append(str(e))
                    with send_lock:
                        campaign_status['remaining'] -= 1
                    continue
            
            # Check if all emails are sent
            if campaign_status['remaining'] <= 0:
                campaign_status['is_running'] = False
                campaign_status['completed'] = True
                logger.info("Campaign completed!")

        # Start worker threads
        threads = []
        for _ in range(max_connections):
            thread = threading.Thread(target=worker)
            thread.daemon = True  # Make thread daemon so it exits when main thread exits
            thread.start()
            threads.append(thread)

        logger.info("Email campaign started")
        return jsonify({"message": "Email campaign started!"})
    except Exception as e:
        logger.error(f"Error starting campaign: {str(e)}")
        campaign_status['is_running'] = False
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    # Allow OAuth to work in development environment
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # For development only
    os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'  # Allow some scope differences
    
    # Install PyJWT if needed for ID token parsing
    try:
        import jwt
    except ImportError:
        logger.warning("PyJWT not installed. ID token parsing fallback will not work.")
        logger.warning("Install with: pip install PyJWT")
    
    # Print startup information
    logger.info("Starting Email Automation Backend")
    logger.info(f"Client secrets file: {os.path.abspath(CLIENT_SECRETS_FILE)}")
    
    app.run(debug=True, host='0.0.0.0')
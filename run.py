"""Single command demo launcher. Works with Python 3.10+, no pip install."""
import os
from app.server import serve

if __name__ == '__main__':
    serve(host=os.getenv('HOST','127.0.0.1'), port=int(os.getenv('PORT','8000')))

Put
(1) Launcher.exe
(2) Setup.exe
before start or build

#1. Install Ubuntu:
if not exist C:\WSL\Ubuntu mkdir C:\WSL\Ubuntu && ^
curl -L -o "%TEMP%\ubuntu2404.rootfs.tar.gz" https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz && ^
wsl --import Ubuntu C:\WSL\Ubuntu "%TEMP%\ubuntu2404.rootfs.tar.gz" --version 2 && ^
wsl -d Ubuntu --user root bash -c "useradd -m -s /bin/bash tensorcfd && echo 'tensorcfd:1234' | chpasswd && usermod -aG sudo tensorcfd && printf '[user]\ndefault=tensorcfd\n' > /etc/wsl.conf" && ^
wsl -s Ubuntu


#2. Install OpenFOAM
wsl -d Ubuntu --user tensorcfd bash -c "echo '1234' | sudo -S bash -c 'curl -s https://dl.openfoam.com/add-debian-repo.sh | bash && apt-get update -y && apt-get install -y openfoam2506-default'"



#3. Install paraView
curl -L -o paraview.zip https://www.paraview.org/files/v6.0/ParaView-6.0.1-Windows-Python3.12-msvc2017-AMD64.zip && powershell -command "Expand-Archive -Path 'paraview.zip' -DestinationPath 'C:\tensorCFD\tensorHVAC-Pro-2025' -Force"

#4. Install blender
curl -L -o blender.zip https://mirror.clarkson.edu/blender/release/Blender4.5/blender-4.5.3-windows-x64.zip && powershell -command "Expand-Archive -Path 'blender.zip' -DestinationPath 'C:\tensorCFD\tensorHVAC-Pro-2025' -Force"

#5. Install tensorHAC-Pro-Setup-2025
The “tensorHVAC-Pro-2025.exe” already in /assets/.., move it to 'C:\tensorCFD\tensorHVAC-Pro-2025' and create a shortcut to open this in desktop
